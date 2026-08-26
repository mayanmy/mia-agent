import { Buffer } from "node:buffer";

import { Logger } from "@nestjs/common";

import { createMcpSafeFetch } from "../mcp-network-policy";

export type McpClientCredentialsConfig = {
  cacheKey: string;
  serverId: string;
  tokenUrl: string;
  clientAuthMethod: "body" | "basic";
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  tokenField: string;
  expiresInField?: string;
  tokenTypeField?: string;
  defaultTtlSeconds: number;
  refreshBeforeSeconds: number;
  timeoutMs: number;
  allowPrivateNetwork: boolean;
};

type CachedToken = {
  value: string;
  type: string;
  expiresAt: number;
};

/**
 * MCP client_credentials Provider 实现 SDK 的最小 AuthProvider 协议。
 * Token 仅驻留进程内存；并发请求共享刷新 Promise，401 会清缓存并强制刷新一次。
 */
export class McpClientCredentialsProvider {
  private readonly logger = new Logger(McpClientCredentialsProvider.name);
  private cached?: CachedToken;
  private refreshFlight?: Promise<CachedToken>;

  constructor(private readonly config: McpClientCredentialsConfig) {}

  async token(): Promise<string> {
    const token = await this.getToken(false);
    return `${token.type} ${token.value}`;
  }

  /** Transport 收到 401 后调用；方法返回后 SDK 会使用新 Token 重试原请求一次。 */
  async onUnauthorized(): Promise<void> {
    await this.getToken(true);
  }

  private async getToken(forceRefresh: boolean): Promise<CachedToken> {
    if (forceRefresh) this.cached = undefined;
    const refreshAt = this.cached
      ? this.cached.expiresAt - this.config.refreshBeforeSeconds * 1_000
      : 0;
    if (this.cached && Date.now() < refreshAt) return this.cached;
    if (this.refreshFlight) return this.refreshFlight;

    const startedAt = Date.now();
    this.refreshFlight = this.requestToken()
      .then((token) => {
        this.cached = token;
        this.logger.debug(
          `MCP token refreshed: server=${this.config.serverId} elapsedMs=${Date.now() - startedAt}`
        );
        return token;
      })
      .finally(() => {
        this.refreshFlight = undefined;
      });
    return this.refreshFlight;
  }

  /** Token Endpoint 与 MCP Endpoint 使用相同 SSRF/重定向策略，避免凭据被 30x 带出。 */
  private async requestToken(): Promise<CachedToken> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    });
    const body = new URLSearchParams({ grant_type: "client_credentials" });

    if (this.config.clientAuthMethod === "basic") {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`
      );
    } else {
      body.set("client_id", this.config.clientId);
      body.set("client_secret", this.config.clientSecret);
    }
    if (this.config.scope) body.set("scope", this.config.scope);
    if (this.config.audience) body.set("audience", this.config.audience);

    try {
      const response = await createMcpSafeFetch(this.config.allowPrivateNetwork)(
        this.config.tokenUrl,
        {
          method: "POST",
          headers,
          body: body.toString(),
          signal: controller.signal
        }
      );
      const text = await this.readLimitedBody(response, 1_000_000);
      if (!response.ok) throw new Error(`MCP token endpoint returned HTTP ${response.status}`);

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("MCP token endpoint must return JSON");
      }
      if (!payload || Array.isArray(payload) || typeof payload !== "object") {
        throw new Error("MCP token endpoint must return a JSON object");
      }
      return this.parseToken(payload as Record<string, unknown>);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseToken(payload: Record<string, unknown>): CachedToken {
    const token = this.readField(payload, this.config.tokenField);
    if (typeof token !== "string" || !token) {
      throw new Error(`MCP token field ${this.config.tokenField} is missing`);
    }
    const type = this.config.tokenTypeField
      ? this.readField(payload, this.config.tokenTypeField)
      : undefined;
    const expiresIn = this.config.expiresInField
      ? Number(this.readField(payload, this.config.expiresInField))
      : this.config.defaultTtlSeconds;
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("MCP token expires_in value is invalid");
    }
    return {
      value: token,
      type: typeof type === "string" && type ? type : "Bearer",
      expiresAt: Date.now() + expiresIn * 1_000
    };
  }

  private readField(payload: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
      if (!current || Array.isArray(current) || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, payload);
  }

  /** Token 响应上限独立于工具响应，防止错误页面或恶意 AS 占用过多内存。 */
  private async readLimitedBody(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("MCP token response is too large");
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
