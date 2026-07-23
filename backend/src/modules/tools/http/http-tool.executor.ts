import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Injectable, Logger } from "@nestjs/common";

import {
  HttpToolClientCredentialsAuthConfig,
  HttpToolCustomTokenAuthConfig,
  HttpToolDynamicAuthConfig,
  HttpToolParameter,
  HttpToolRuntimeConfig
} from "../dto/http-tool.dto";
import { ToolJsonValue } from "../dto/tool.dto";

const MAX_REDIRECTS = 3;
const MAX_TOKEN_RESPONSE_BYTES = 1_000_000;
const FORBIDDEN_MODEL_HEADERS = new Set([
  "authorization",
  "cookie",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding"
]);

@Injectable()
export class HttpToolExecutor {
  private readonly logger = new Logger(HttpToolExecutor.name);
  private readonly tokenCache = new Map<string, CachedAccessToken>();
  private readonly tokenFlights = new Map<string, Promise<CachedAccessToken>>();

  /** 执行已预配置的 HTTP Tool；URL、固定 Header 和凭据始终来自服务端配置。 */
  async execute(
    config: HttpToolRuntimeConfig,
    rawInput: Record<string, ToolJsonValue>,
    upstreamSignal?: AbortSignal
  ): Promise<ToolJsonValue> {
    const input = this.validateInput(config.parameters, rawInput);
    const request = this.buildRequest(config, input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const abortUpstream = () => controller.abort();
    upstreamSignal?.addEventListener("abort", abortUpstream, { once: true });

    try {
      let authentication = await this.applyAuthentication(request.init, config, controller.signal);
      let response = await this.fetchWithRedirectPolicy(
        request.url,
        authentication.init,
        config,
        controller.signal
      );

      if (response.status === 401 && this.isDynamicAuth(config)) {
        // 先释放首个响应流再重试，避免 401 body 占住底层连接。
        await response.body?.cancel();
        authentication = await this.applyAuthentication(
          request.init,
          config,
          controller.signal,
          true
        );
        response = await this.fetchWithRedirectPolicy(
          request.url,
          authentication.init,
          config,
          controller.signal
        );
      }
      const body = await this.readLimitedResponse(response, config.maxResponseBytes);

      return {
        // 返回配置模板而非展开后的 URL，避免敏感 Path/Query 参数进入 SSE、日志和 Run Trace。
        url: new URL(config.path, `${config.baseUrl}/`).toString(),
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type") ?? "",
        headers: this.pickResponseHeaders(response.headers),
        body: this.sanitizeResponseBody(
          this.parseResponseBody(body),
          authentication.sensitiveValues
        )
      };
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortUpstream);
    }
  }

  /** 校验模型参数并补入服务端默认值，拒绝未声明字段。 */
  private validateInput(
    parameters: HttpToolParameter[],
    rawInput: Record<string, ToolJsonValue>
  ): Record<string, ToolJsonValue> {
    const declared = new Map(parameters.map((parameter) => [parameter.name, parameter]));
    const unknownNames = Object.keys(rawInput).filter((name) => !declared.has(name));

    if (unknownNames.length > 0) {
      throw new Error(`unknown parameters: ${unknownNames.join(", ")}`);
    }

    const input: Record<string, ToolJsonValue> = {};

    for (const parameter of parameters) {
      const value = rawInput[parameter.name] ?? parameter.defaultValue;

      if (value === undefined || value === null || value === "") {
        if (parameter.required) {
          throw new Error(`${parameter.name} is required`);
        }
        continue;
      }

      if (!this.matchesType(value, parameter.type)) {
        throw new Error(`${parameter.name} must be ${parameter.type}`);
      }

      input[parameter.name] = value;
    }

    return input;
  }

  /** 使用结构化 URL/Headers API 组装请求，业务参数无法改变目标 Host。 */
  private buildRequest(
    config: HttpToolRuntimeConfig,
    input: Record<string, ToolJsonValue>
  ): { url: URL; init: RequestInit } {
    let path = config.path;
    const query = new URLSearchParams();
    const body: Record<string, ToolJsonValue> = {};
    const headers = new Headers({ accept: "application/json, text/plain;q=0.9, */*;q=0.8" });

    for (const fixedHeader of config.fixedHeaders) {
      headers.set(fixedHeader.name, fixedHeader.value);
    }

    for (const parameter of config.parameters) {
      const value = input[parameter.name];
      const targetName = parameter.targetName || parameter.name;

      if (value === undefined) continue;

      if (parameter.location === "path") {
        path = path.replaceAll(`{${targetName}}`, encodeURIComponent(String(value)));
      } else if (parameter.location === "query") {
        this.appendQueryValue(query, targetName, value);
      } else if (parameter.location === "header") {
        if (FORBIDDEN_MODEL_HEADERS.has(targetName.toLowerCase())) {
          throw new Error(`${targetName} header is not allowed`);
        }
        headers.set(targetName, this.stringifyScalar(value));
      } else {
        body[targetName] = value;
      }
    }

    if (/\{[^{}]+\}/.test(path)) {
      throw new Error("path contains unresolved parameters");
    }

    const url = new URL(path, `${config.baseUrl}/`);
    query.forEach((value, key) => url.searchParams.append(key, value));
    if (config.method === "POST") {
      headers.set("content-type", "application/json");
    }

    return {
      url,
      init: {
        method: config.method,
        headers,
        body: config.method === "POST" ? JSON.stringify(body) : undefined,
        redirect: "manual"
      }
    };
  }

  /** 每一跳重定向都重新执行 DNS/私网检查，避免目标通过 30x 绕过策略。 */
  private async fetchWithRedirectPolicy(
    initialUrl: URL,
    initialInit: RequestInit,
    config: HttpToolRuntimeConfig,
    signal: AbortSignal
  ): Promise<Response> {
    let url = initialUrl;
    let init = { ...initialInit, signal };

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await this.assertUrlAllowed(url, config.allowPrivateNetwork);
      const response = await fetch(url, init);

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }

      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("http redirect limit exceeded");
      }

      const redirectedUrl = new URL(location, url);
      // 307/308 会保留包含凭据的请求体，仅删除 Header 仍不安全，因此跨 Origin 重定向直接拒绝。
      if (redirectedUrl.origin !== url.origin) {
        throw new Error("cross-origin http redirects are not allowed");
      }
      url = redirectedUrl;
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && init.method === "POST")
      ) {
        const headers = new Headers(init.headers);
        headers.delete("content-type");
        init = { ...init, method: "GET", body: undefined, headers };
      }
    }

    throw new Error("http redirect limit exceeded");
  }

  /** 解析目标的全部地址；只有工具显式允许时才能访问本机或私网。 */
  private async assertUrlAllowed(url: URL, allowPrivateNetwork: boolean): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("url must use http or https");
    }

    if (url.username || url.password) {
      throw new Error("url credentials are not allowed");
    }

    const hostname = url.hostname.toLowerCase();
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });

    if (addresses.length === 0) {
      throw new Error("url hostname cannot be resolved");
    }

    if (!allowPrivateNetwork && addresses.some(({ address }) => this.isPrivateAddress(address))) {
      throw new Error("url hostname resolves to a private address");
    }
  }

  /** 凭据在请求发出前最后注入；动态 Token 的获取过程不会进入工具输出和 Run Trace。 */
  private async applyAuthentication(
    init: RequestInit,
    config: HttpToolRuntimeConfig,
    signal: AbortSignal,
    forceRefresh = false
  ): Promise<{ init: RequestInit; sensitiveValues: string[] }> {
    const headers = new Headers(init.headers);
    const credentialValues = Object.values(config.credentials).filter(Boolean);
    if (config.authType === "none") {
      return { init: { ...init, headers }, sensitiveValues: [] };
    }

    if (this.isDynamicAuth(config)) {
      const token = await this.getDynamicAccessToken(config, signal, forceRefresh);
      const authConfig = config.authConfig;
      if (!authConfig) throw new Error("dynamic authentication config is missing");
      if (config.authType === "custom_token") {
        const custom = authConfig as HttpToolCustomTokenAuthConfig;
        headers.set(
          custom.headerName,
          custom.tokenPrefix ? `${custom.tokenPrefix} ${token.value}` : token.value
        );
      } else {
        headers.set("authorization", `${token.type || "Bearer"} ${token.value}`);
      }
      return {
        init: { ...init, headers },
        sensitiveValues: [...credentialValues, token.value]
      };
    }

    if (!config.secret) throw new Error("tool secret is not configured");
    if (config.authType === "bearer") {
      headers.set("authorization", `Bearer ${config.secret}`);
    } else {
      headers.set(config.authHeaderName || "X-API-Key", config.secret);
    }
    return { init: { ...init, headers }, sensitiveValues: [config.secret] };
  }

  /** 缓存命中时直接复用；同一配置版本的并发刷新共享一个 Promise。 */
  private async getDynamicAccessToken(
    config: HttpToolRuntimeConfig,
    signal: AbortSignal,
    forceRefresh: boolean
  ): Promise<CachedAccessToken> {
    const authConfig = config.authConfig;
    if (!authConfig) throw new Error("dynamic authentication config is missing");
    this.pruneSupersededTokens(config);
    if (forceRefresh) this.tokenCache.delete(config.tokenCacheKey);

    const cached = this.tokenCache.get(config.tokenCacheKey);
    const refreshAt = cached ? cached.expiresAt - authConfig.refreshBeforeSeconds * 1000 : 0;
    if (cached && Date.now() < refreshAt) {
      this.logger.debug(`dynamic auth token cache hit: tool=${config.id}`);
      return cached;
    }

    const inFlight = this.tokenFlights.get(config.tokenCacheKey);
    if (inFlight) return this.awaitWithSignal(inFlight, signal);

    const refreshController = new AbortController();
    const refreshTimeout = setTimeout(() => refreshController.abort(), config.timeoutMs);
    const startedAt = Date.now();
    const flight = this.requestDynamicAccessToken(config, refreshController.signal)
      .then((token) => {
        this.tokenCache.set(config.tokenCacheKey, token);
        this.logger.debug(
          `dynamic auth token refreshed: tool=${config.id} elapsedMs=${Date.now() - startedAt}`
        );
        return token;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown error";
        this.logger.warn(`dynamic auth token refresh failed: tool=${config.id} error=${message}`);
        throw error;
      })
      .finally(() => {
        clearTimeout(refreshTimeout);
        this.tokenFlights.delete(config.tokenCacheKey);
      });
    this.tokenFlights.set(config.tokenCacheKey, flight);
    return this.awaitWithSignal(flight, signal);
  }

  /** 标准与自定义 Token 模式最终都归一成受 SSRF 策略保护的 HTTP 请求。 */
  private async requestDynamicAccessToken(
    config: HttpToolRuntimeConfig,
    signal: AbortSignal
  ): Promise<CachedAccessToken> {
    if (!config.authConfig) throw new Error("dynamic authentication config is missing");
    const request =
      config.authType === "oauth2_client_credentials"
        ? this.buildClientCredentialsTokenRequest(
            config.authConfig as HttpToolClientCredentialsAuthConfig,
            config.credentials
          )
        : this.buildCustomTokenRequest(
            config.authConfig as HttpToolCustomTokenAuthConfig,
            config.credentials
          );
    const response = await this.fetchWithRedirectPolicy(request.url, request.init, config, signal);
    const body = await this.readLimitedResponse(response, MAX_TOKEN_RESPONSE_BYTES);
    if (!response.ok) throw new Error(`token endpoint returned HTTP ${response.status}`);

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("token endpoint must return JSON");
    }
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      throw new Error("token endpoint must return a JSON object");
    }
    return this.parseAccessToken(payload as Record<string, unknown>, config.authConfig);
  }

  /** OAuth2 client_credentials 支持 body 与 HTTP Basic 两种客户端认证方式。 */
  private buildClientCredentialsTokenRequest(
    config: HttpToolClientCredentialsAuthConfig,
    credentials: Record<string, string>
  ): { url: URL; init: RequestInit } {
    const clientId = credentials.clientId;
    const clientSecret = credentials.clientSecret;
    if (!clientId || !clientSecret) throw new Error("client credentials are not configured");

    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    });
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    if (config.clientAuthMethod === "basic") {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      );
    } else {
      body.set("client_id", clientId);
      body.set("client_secret", clientSecret);
    }
    if (config.scope) body.set("scope", config.scope);
    if (config.audience) body.set("audience", config.audience);
    return {
      url: new URL(config.tokenUrl),
      init: { method: "POST", headers, body: body.toString(), redirect: "manual" }
    };
  }

  /** 自定义 Token 请求通过结构化映射注入常量和凭据，避免执行任意模板表达式。 */
  private buildCustomTokenRequest(
    config: HttpToolCustomTokenAuthConfig,
    credentials: Record<string, string>
  ): { url: URL; init: RequestInit } {
    const url = new URL(config.tokenUrl);
    const headers = new Headers({ accept: "application/json" });
    const body: Record<string, string> = {};

    for (const parameter of config.parameters) {
      const value = parameter.credentialKey
        ? credentials[parameter.credentialKey]
        : parameter.value;
      if (value === undefined) {
        throw new Error(`token credential ${parameter.credentialKey} is not configured`);
      }
      if (parameter.location === "header") headers.set(parameter.name, value);
      else if (parameter.location === "query") url.searchParams.append(parameter.name, value);
      else body[parameter.name] = value;
    }

    let requestBody: string | undefined;
    if (config.method === "POST") {
      if (config.contentType === "form_urlencoded") {
        headers.set("content-type", "application/x-www-form-urlencoded");
        requestBody = new URLSearchParams(body).toString();
      } else {
        headers.set("content-type", "application/json");
        requestBody = JSON.stringify(body);
      }
    }
    return {
      url,
      init: { method: config.method, headers, body: requestBody, redirect: "manual" }
    };
  }

  /** 按点号字段路径提取 Token，并统一计算绝对过期时间。 */
  private parseAccessToken(
    payload: Record<string, unknown>,
    config: HttpToolDynamicAuthConfig
  ): CachedAccessToken {
    const tokenValue = this.readFieldPath(payload, config.tokenField);
    if (typeof tokenValue !== "string" || !tokenValue) {
      throw new Error(`token field ${config.tokenField} is missing or empty`);
    }
    const typeValue = config.tokenTypeField
      ? this.readFieldPath(payload, config.tokenTypeField)
      : undefined;
    const expiresAtValue = config.expiresAtField
      ? this.readFieldPath(payload, config.expiresAtField)
      : undefined;
    const expiresInValue = config.expiresInField
      ? this.readFieldPath(payload, config.expiresInField)
      : undefined;
    return {
      value: tokenValue,
      type: typeof typeValue === "string" && typeValue ? typeValue : "Bearer",
      expiresAt: this.resolveTokenExpiry(expiresAtValue, expiresInValue, config.defaultTtlSeconds)
    };
  }

  private readFieldPath(payload: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
      if (!current || Array.isArray(current) || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
  }

  private resolveTokenExpiry(
    expiresAtValue: unknown,
    expiresInValue: unknown,
    defaultTtlSeconds: number
  ): number {
    if (expiresAtValue !== undefined && expiresAtValue !== null && expiresAtValue !== "") {
      const numeric = typeof expiresAtValue === "string" ? Number(expiresAtValue) : expiresAtValue;
      if (typeof numeric === "number" && Number.isFinite(numeric)) {
        const expiresAt = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        if (expiresAt <= Date.now()) throw new Error("token is already expired");
        return expiresAt;
      }
      if (typeof expiresAtValue === "string") {
        const parsed = Date.parse(expiresAtValue);
        if (Number.isFinite(parsed) && parsed > Date.now()) return parsed;
      }
      throw new Error("token expiresAt value is invalid");
    }
    if (expiresInValue !== undefined && expiresInValue !== null && expiresInValue !== "") {
      const seconds = Number(expiresInValue);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error("token expiresIn value is invalid");
      }
      return Date.now() + seconds * 1000;
    }
    return Date.now() + defaultTtlSeconds * 1000;
  }

  /** 等待共享刷新时仍尊重当前调用的取消信号，但不会取消其他调用共享的请求。 */
  private async awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        }
      );
    });
  }

  private isDynamicAuth(config: HttpToolRuntimeConfig): boolean {
    return config.authType === "oauth2_client_credentials" || config.authType === "custom_token";
  }

  /** 同一工具保存新版本后移除旧版本缓存，避免长期运行进程积累不可达 Token。 */
  private pruneSupersededTokens(config: HttpToolRuntimeConfig): void {
    const prefix = `${config.id}:`;
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(prefix) && key !== config.tokenCacheKey) this.tokenCache.delete(key);
    }
  }

  /** 数组 Query 使用重复 key，其他复杂值序列化为 JSON，避免手工拼接编码错误。 */
  private appendQueryValue(query: URLSearchParams, name: string, value: ToolJsonValue): void {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(name, this.stringifyScalar(item)));
      return;
    }

    query.append(name, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  /** Header 只接受标量，避免隐式产生 `[object Object]`。 */
  private stringifyScalar(value: ToolJsonValue): string {
    if (typeof value === "object") throw new Error("header parameters must be scalar values");
    return String(value);
  }

  /** 按工具 Schema 检查 JSON 值类型。 */
  private matchesType(value: ToolJsonValue, type: HttpToolParameter["type"]): boolean {
    if (type === "array") return Array.isArray(value);
    if (type === "object")
      return typeof value === "object" && value !== null && !Array.isArray(value);
    return typeof value === type;
  }

  /** 识别 IPv4/IPv6 回环、私网、链路本地、共享地址和保留地址。 */
  private isPrivateAddress(address: string): boolean {
    const normalized = address.toLowerCase().split("%")[0];

    if (normalized.includes(":")) {
      return (
        normalized === "::1" ||
        normalized === "::" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith("::ffff:127.") ||
        normalized.startsWith("::ffff:10.") ||
        normalized.startsWith("::ffff:192.168.")
      );
    }

    const parts = normalized.split(".").map(Number);
    const [first, second] = parts;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  /** 流式限制响应大小，超限时立即取消读取，避免内存被大响应占满。 */
  private async readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("response body is too large");
      }
      chunks.push(value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
  }

  /** JSON 响应返回结构化值，其他内容保留原文本。 */
  private parseResponseBody(text: string): ToolJsonValue {
    if (!text) return "";
    try {
      return JSON.parse(text) as ToolJsonValue;
    } catch {
      return text;
    }
  }

  /** 响应若回显凭据或常见敏感字段，在交给模型和日志前递归脱敏。 */
  private sanitizeResponseBody(value: ToolJsonValue, sensitiveValues: string[]): ToolJsonValue {
    if (typeof value === "string") {
      return sensitiveValues.reduce(
        (sanitized, sensitive) =>
          sensitive ? sanitized.replaceAll(sensitive, "[REDACTED]") : sanitized,
        value
      );
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeResponseBody(item, sensitiveValues));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          /(authorization|api[_-]?key|token|secret|password|cookie)/iu.test(key)
            ? "[REDACTED]"
            : this.sanitizeResponseBody(item, sensitiveValues)
        ])
      );
    }
    return value;
  }

  /** 只暴露排障所需响应头，明确排除 Set-Cookie 等敏感值。 */
  private pickResponseHeaders(headers: Headers): Record<string, ToolJsonValue> {
    const result: Record<string, ToolJsonValue> = {};
    for (const name of ["content-type", "content-length", "etag", "last-modified"]) {
      const value = headers.get(name);
      if (value) result[name] = value;
    }
    return result;
  }
}

type CachedAccessToken = {
  value: string;
  type: string;
  expiresAt: number;
};
