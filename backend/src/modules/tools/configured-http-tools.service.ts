import { HttpStatus, Injectable } from "@nestjs/common";
import { HttpTool, Prisma, ToolSecret } from "@prisma/client";

import { decryptSecret, encryptSecret } from "../../core/crypto";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import {
  HttpToolAuthType,
  HttpToolClientCredentialsAuthConfig,
  HttpToolCreateDto,
  HttpToolCustomTokenAuthConfig,
  HttpToolCustomTokenParameter,
  HttpToolDetail,
  HttpToolDynamicAuthConfig,
  HttpToolFixedHeader,
  HttpToolListItem,
  HttpToolMethod,
  HttpToolParameter,
  HttpToolRuntimeConfig,
  HttpToolUpdateDto
} from "./dto/http-tool.dto";
import { ToolDefinition, ToolInputSchema, ToolJsonValue } from "./dto/tool.dto";

const HTTP_TOOL_PREFIX = "http_";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const DEFAULT_TOKEN_TTL_SECONDS = 300;
const DEFAULT_TOKEN_REFRESH_BEFORE_SECONDS = 60;
const DYNAMIC_AUTH_TYPES = new Set<HttpToolAuthType>(["oauth2_client_credentials", "custom_token"]);
const FORBIDDEN_FIXED_HEADERS = new Set([
  "authorization",
  "cookie",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding"
]);
const FORBIDDEN_TOKEN_HEADERS = new Set([
  "cookie",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding"
]);

type HttpToolWithSecret = HttpTool & { secret: ToolSecret | null };

@Injectable()
export class ConfiguredHttpToolsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 返回管理页面需要的 HTTP Tool 列表，凭据只暴露是否已配置。 */
  async listHttpTools(): Promise<HttpToolListItem[]> {
    const tools = await this.prisma.httpTool.findMany({
      where: { deletedAt: null },
      include: { secret: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return tools.map((tool) => this.toListItem(tool));
  }

  /** 创建配置与可选 Secret，并保证任一写入失败时整体回滚。 */
  async createHttpTool(payload: HttpToolCreateDto, userId: string): Promise<HttpToolDetail> {
    const data = this.validateCreate(payload);
    await this.ensureSlugAvailable(data.slug);

    const tool = await this.prisma.$transaction(async (transaction) => {
      const secret = data.credentialPayload
        ? await transaction.toolSecret.create({
            data: {
              name: `${data.slug}_credential`,
              encryptedValue: encryptSecret(data.credentialPayload),
              createdByUserId: userId
            }
          })
        : null;

      return transaction.httpTool.create({
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description,
          enabled: data.enabled,
          method: data.method,
          baseUrl: data.baseUrl,
          path: data.path,
          parameters: data.parameters as unknown as Prisma.InputJsonValue,
          fixedHeaders: data.fixedHeaders as unknown as Prisma.InputJsonValue,
          authType: data.authType,
          authHeaderName: data.authHeaderName,
          authConfig: (data.authConfig ?? {}) as unknown as Prisma.InputJsonValue,
          secretId: secret?.id,
          timeoutMs: data.timeoutMs,
          maxResponseBytes: data.maxResponseBytes,
          allowPrivateNetwork: data.allowPrivateNetwork,
          createdByUserId: userId
        },
        include: { secret: true }
      });
    });

    return this.toDetail(tool);
  }

  /** 读取单个配置；软删除记录不再对管理端和 Runtime 可见。 */
  async getHttpTool(id: string): Promise<HttpToolDetail> {
    return this.toDetail(await this.findHttpTool(id));
  }

  /** 更新工具与凭据。未传凭据表示保留；切换鉴权类型时必须提交新格式凭据。 */
  async updateHttpTool(
    id: string,
    payload: HttpToolUpdateDto,
    userId: string
  ): Promise<HttpToolDetail> {
    const existing = await this.findHttpTool(id);
    const data = this.validateUpdate(payload, existing);
    await this.ensureSlugAvailable(data.slug, id);

    const tool = await this.prisma.$transaction(async (transaction) => {
      let secretId = existing.secretId;

      if (data.credentialPayload !== undefined) {
        if (data.credentialPayload) {
          if (existing.secretId) {
            await transaction.toolSecret.update({
              where: { id: existing.secretId },
              data: {
                encryptedValue: encryptSecret(data.credentialPayload),
                name: `${data.slug}_credential`
              }
            });
          } else {
            const secret = await transaction.toolSecret.create({
              data: {
                name: `${data.slug}_credential`,
                encryptedValue: encryptSecret(data.credentialPayload),
                createdByUserId: userId
              }
            });
            secretId = secret.id;
          }
        } else {
          secretId = null;
        }
      }

      if (data.authType === "none") secretId = null;
      if (data.authType !== "none" && !secretId) {
        throw new AppError(ErrorCodes.common.badRequest, "authentication secret is required");
      }

      const updated = await transaction.httpTool.update({
        where: { id },
        data: {
          name: data.name,
          slug: data.slug,
          description: data.description,
          enabled: data.enabled,
          method: data.method,
          baseUrl: data.baseUrl,
          path: data.path,
          parameters: data.parameters as unknown as Prisma.InputJsonValue,
          fixedHeaders: data.fixedHeaders as unknown as Prisma.InputJsonValue,
          authType: data.authType,
          authHeaderName: data.authHeaderName,
          authConfig: (data.authConfig ?? {}) as unknown as Prisma.InputJsonValue,
          secretId,
          timeoutMs: data.timeoutMs,
          maxResponseBytes: data.maxResponseBytes,
          allowPrivateNetwork: data.allowPrivateNetwork
        },
        include: { secret: true }
      });

      if (existing.secretId && existing.secretId !== secretId) {
        await transaction.toolSecret.delete({ where: { id: existing.secretId } });
      }

      return updated;
    });

    return this.toDetail(tool);
  }

  /** 软删除工具并停用，使历史日志仍能保留原 runtimeId。 */
  async deleteHttpTool(id: string): Promise<void> {
    await this.findHttpTool(id);
    await this.prisma.httpTool.update({
      where: { id },
      data: { enabled: false, deletedAt: new Date() }
    });
  }

  /** 合并数据库工具定义；模型只看到声明的业务参数。 */
  async getToolDefinitions(runtimeIds: string[]): Promise<ToolDefinition[]> {
    const ids = runtimeIds
      .filter((id) => id.startsWith(HTTP_TOOL_PREFIX))
      .map((id) => id.slice(HTTP_TOOL_PREFIX.length))
      .filter(Boolean);
    if (ids.length === 0) return [];

    const tools = await this.prisma.httpTool.findMany({
      where: { id: { in: ids }, enabled: true, deletedAt: null }
    });
    const byId = new Map(tools.map((tool) => [tool.id, tool]));

    return ids.flatMap((id) => {
      const tool = byId.get(id);
      return tool ? [this.toDefinition(tool)] : [];
    });
  }

  /** 将 runtimeId 解析成不含明文凭据的数据库配置。 */
  async resolveRuntimeConfig(runtimeId: string): Promise<HttpToolRuntimeConfig | null> {
    if (!runtimeId.startsWith(HTTP_TOOL_PREFIX)) return null;
    const id = runtimeId.slice(HTTP_TOOL_PREFIX.length);
    const tool = await this.prisma.httpTool.findFirst({
      where: { id, enabled: true, deletedAt: null },
      include: { secret: true }
    });
    if (!tool) return null;

    return {
      id: tool.id,
      method: tool.method as HttpToolMethod,
      baseUrl: tool.baseUrl,
      path: tool.path,
      parameters: this.readParameters(tool.parameters),
      fixedHeaders: this.readFixedHeaders(tool.fixedHeaders),
      authType: tool.authType as HttpToolAuthType,
      authHeaderName: tool.authHeaderName,
      ...this.decodeRuntimeCredential(
        tool.authType as HttpToolAuthType,
        tool.secret ? decryptSecret(tool.secret.encryptedValue) : null
      ),
      authConfig: this.readAuthConfig(tool.authType as HttpToolAuthType, tool.authConfig),
      tokenCacheKey: `${tool.id}:${tool.updatedAt.toISOString()}`,
      timeoutMs: tool.timeoutMs,
      maxResponseBytes: tool.maxResponseBytes,
      allowPrivateNetwork: tool.allowPrivateNetwork
    };
  }

  /** 日志按配置中的 sensitive 标记脱敏，不改变执行时真实参数。 */
  async sanitizeInput(
    runtimeId: string,
    input: Record<string, ToolJsonValue>
  ): Promise<Record<string, ToolJsonValue>> {
    const config = await this.resolveRuntimeConfig(runtimeId);
    if (!config) return input;
    const sensitiveNames = new Set(
      config.parameters
        .filter((parameter) => parameter.sensitive)
        .map((parameter) => parameter.name)
    );
    return Object.fromEntries(
      Object.entries(input).map(([name, value]) => [
        name,
        sensitiveNames.has(name) ? "[REDACTED]" : value
      ])
    );
  }

  /** 将外部 DTO 收敛成可直接持久化的完整配置快照。 */
  private validateCreate(payload: HttpToolCreateDto, hasExistingCredential = false) {
    const authType = this.normalizeAuthType(payload.authType ?? "none");
    const secret = this.normalizeOptionalSecret(payload.secret);
    const credentials = this.normalizeCredentials(payload.credentials);
    const authConfig = this.normalizeAuthConfig(authType, payload.authConfig);
    const credentialPayload = this.encodeCredential(authType, secret, credentials, authConfig);
    if (authType !== "none" && !credentialPayload && !hasExistingCredential) {
      throw new AppError(ErrorCodes.common.badRequest, "authentication secret is required");
    }

    const method = this.normalizeMethod(payload.method);
    const path = this.normalizePath(payload.path);
    const parameters = this.normalizeParameters(payload.parameters ?? [], method);
    this.validatePathParameters(path, parameters);

    return {
      name: this.normalizeRequiredString(payload.name, "name", 100),
      slug: this.normalizeSlug(payload.slug),
      description: this.normalizeString(payload.description, 1000),
      enabled: payload.enabled ?? true,
      method,
      baseUrl: this.normalizeBaseUrl(payload.baseUrl),
      path,
      parameters,
      fixedHeaders: this.normalizeFixedHeaders(payload.fixedHeaders ?? []),
      authType,
      authHeaderName: this.normalizeAuthHeaderName(authType, payload.authHeaderName),
      authConfig,
      credentialPayload,
      timeoutMs: this.normalizeInteger(
        payload.timeoutMs,
        DEFAULT_TIMEOUT_MS,
        1,
        30_000,
        "timeoutMs"
      ),
      maxResponseBytes: this.normalizeInteger(
        payload.maxResponseBytes,
        DEFAULT_MAX_RESPONSE_BYTES,
        1,
        MAX_RESPONSE_BYTES,
        "maxResponseBytes"
      ),
      allowPrivateNetwork: payload.allowPrivateNetwork ?? false
    };
  }

  /** 更新按完整快照重新校验，同一种鉴权未提交凭据时保留现有密文。 */
  private validateUpdate(payload: HttpToolUpdateDto, existing: HttpToolWithSecret) {
    const authType = this.normalizeAuthType(payload.authType ?? existing.authType);
    const keepsExistingCredential = authType === existing.authType && Boolean(existing.secret);
    const existingCredentials =
      keepsExistingCredential && DYNAMIC_AUTH_TYPES.has(authType) && existing.secret
        ? this.decodeRuntimeCredential(authType, decryptSecret(existing.secret.encryptedValue))
            .credentials
        : undefined;
    const validated = this.validateCreate(
      {
        name: payload.name ?? existing.name,
        slug: payload.slug ?? existing.slug,
        description: payload.description ?? existing.description,
        enabled: payload.enabled ?? existing.enabled,
        method: (payload.method ?? existing.method) as HttpToolMethod,
        baseUrl: payload.baseUrl ?? existing.baseUrl,
        path: payload.path ?? existing.path,
        parameters: payload.parameters ?? this.readParameters(existing.parameters),
        fixedHeaders: payload.fixedHeaders ?? this.readFixedHeaders(existing.fixedHeaders),
        authType,
        authHeaderName: payload.authHeaderName ?? existing.authHeaderName ?? undefined,
        authConfig:
          payload.authConfig ?? this.readAuthConfig(authType, existing.authConfig) ?? undefined,
        secret: payload.secret,
        credentials:
          payload.credentials === undefined
            ? existingCredentials
            : { ...(existingCredentials ?? {}), ...payload.credentials },
        timeoutMs: payload.timeoutMs ?? existing.timeoutMs,
        maxResponseBytes: payload.maxResponseBytes ?? existing.maxResponseBytes,
        allowPrivateNetwork: payload.allowPrivateNetwork ?? existing.allowPrivateNetwork
      },
      keepsExistingCredential
    );
    const submittedCredential = DYNAMIC_AUTH_TYPES.has(authType)
      ? payload.credentials !== undefined
      : payload.secret !== undefined;
    return {
      ...validated,
      credentialPayload: submittedCredential ? validated.credentialPayload : undefined
    };
  }

  /** 规范参数 Schema，并在保存阶段拒绝位置、类型和 Header 冲突。 */
  private normalizeParameters(value: unknown, method: unknown): HttpToolParameter[] {
    if (!Array.isArray(value) || value.length > 50) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "parameters must be an array with at most 50 items"
      );
    }
    const normalized = value.map((item, index) => {
      if (!item || Array.isArray(item) || typeof item !== "object") {
        throw new AppError(ErrorCodes.common.badRequest, `parameters[${index}] is invalid`);
      }
      const parameter = item as Partial<HttpToolParameter>;
      const name = this.normalizeParameterName(parameter.name);
      const type = parameter.type;
      const location = parameter.location;
      if (!type || !["string", "number", "boolean", "object", "array"].includes(type)) {
        throw new AppError(ErrorCodes.common.badRequest, `${name} parameter type is invalid`);
      }
      if (!location || !["path", "query", "header", "body"].includes(location)) {
        throw new AppError(ErrorCodes.common.badRequest, `${name} parameter location is invalid`);
      }
      if (location === "body" && this.normalizeMethod(method) !== "POST") {
        throw new AppError(
          ErrorCodes.common.badRequest,
          "GET tools cannot declare body parameters"
        );
      }
      const targetName = this.normalizeTargetName(parameter.targetName, name, location);
      if (location === "header" && FORBIDDEN_FIXED_HEADERS.has(targetName.toLowerCase())) {
        throw new AppError(ErrorCodes.common.badRequest, `${targetName} header is reserved`);
      }
      return {
        name,
        targetName,
        description: this.normalizeString(parameter.description, 300),
        type,
        location,
        required: Boolean(parameter.required),
        sensitive: Boolean(parameter.sensitive),
        ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {})
      } as HttpToolParameter;
    });
    const names = normalized.map((parameter) => parameter.name);
    if (new Set(names).size !== names.length) {
      throw new AppError(ErrorCodes.common.badRequest, "parameter names must be unique");
    }
    return normalized;
  }

  /** Path 模板与参数声明必须一一对应，避免配置保存成功后每次调用都失败。 */
  private validatePathParameters(path: string, parameters: HttpToolParameter[]): void {
    const placeholders = [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
    const pathParameters = parameters.filter((parameter) => parameter.location === "path");
    const targetNames = new Set(
      pathParameters.map((parameter) => parameter.targetName || parameter.name)
    );

    for (const parameter of pathParameters) {
      const targetName = parameter.targetName || parameter.name;
      if (!parameter.required) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          `${parameter.name} path parameter must be required`
        );
      }
      if (!placeholders.includes(targetName)) {
        throw new AppError(ErrorCodes.common.badRequest, `path does not contain {${targetName}}`);
      }
    }

    const missing = placeholders.filter((placeholder) => !targetNames.has(placeholder));
    if (missing.length > 0) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `path placeholders are not declared: ${missing.join(", ")}`
      );
    }
  }

  /** 固定 Header 属于管理员配置，但仍禁止覆盖传输层和鉴权关键字段。 */
  private normalizeFixedHeaders(value: unknown): HttpToolFixedHeader[] {
    if (!Array.isArray(value) || value.length > 30) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "fixedHeaders must be an array with at most 30 items"
      );
    }
    return value.map((item, index) => {
      if (!item || Array.isArray(item) || typeof item !== "object") {
        throw new AppError(ErrorCodes.common.badRequest, `fixedHeaders[${index}] is invalid`);
      }
      const header = item as Partial<HttpToolFixedHeader>;
      const name = this.normalizeRequiredString(header.name, "header name", 100);
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        FORBIDDEN_FIXED_HEADERS.has(name.toLowerCase())
      ) {
        throw new AppError(ErrorCodes.common.badRequest, `${name} header is not allowed`);
      }
      return { name, value: this.normalizeRequiredString(header.value, "header value", 2000) };
    });
  }

  /** Base URL 固定 scheme/host/port，清除 query，业务参数不能改变目标。 */
  private normalizeBaseUrl(value: unknown): string {
    const raw = this.normalizeRequiredString(value, "baseUrl", 2000);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError(ErrorCodes.common.badRequest, "baseUrl is invalid");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new AppError(ErrorCodes.common.badRequest, "baseUrl must be a safe http or https URL");
    }
    url.search = "";
    return url.toString().replace(/\/$/, "");
  }

  /** Path 单独保存且不允许携带 query/fragment，后续由结构化 API 组装。 */
  private normalizePath(value: unknown): string {
    const path = this.normalizeRequiredString(value, "path", 2000);
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("?") ||
      path.includes("#")
    ) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "path must start with / and cannot contain query or fragment"
      );
    }
    return path;
  }

  /** V1 只接受 GET/POST，其他方法留待请求体协议完善后开放。 */
  private normalizeMethod(value: unknown): HttpToolMethod {
    const method = typeof value === "string" ? value.toUpperCase() : "";
    if (method !== "GET" && method !== "POST") {
      throw new AppError(ErrorCodes.common.badRequest, "method must be GET or POST");
    }
    return method;
  }

  /** 收敛当前支持的静态与动态鉴权枚举。 */
  private normalizeAuthType(value: unknown): HttpToolAuthType {
    if (
      value === "none" ||
      value === "bearer" ||
      value === "api_key_header" ||
      value === "oauth2_client_credentials" ||
      value === "custom_token"
    ) {
      return value;
    }
    throw new AppError(ErrorCodes.common.badRequest, "authType is invalid");
  }

  /** API Key Header 有安全默认值，同时拒绝保留 Header。 */
  private normalizeAuthHeaderName(type: HttpToolAuthType, value: unknown): string | null {
    if (type !== "api_key_header") return null;
    const name = this.normalizeRequiredString(value || "X-API-Key", "authHeaderName", 100);
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      FORBIDDEN_FIXED_HEADERS.has(name.toLowerCase())
    ) {
      throw new AppError(ErrorCodes.common.badRequest, "authHeaderName is invalid");
    }
    return name;
  }

  /** 动态鉴权配置只保存非敏感的请求规则与响应字段路径。 */
  private normalizeAuthConfig(
    type: HttpToolAuthType,
    value: unknown
  ): HttpToolDynamicAuthConfig | null {
    if (!DYNAMIC_AUTH_TYPES.has(type)) return null;
    const raw = value && !Array.isArray(value) && typeof value === "object" ? value : {};
    const config = raw as Record<string, unknown>;
    const responseConfig = {
      tokenField: this.normalizeFieldPath(config.tokenField, "access_token", "tokenField"),
      expiresInField: this.normalizeOptionalFieldPath(
        config.expiresInField,
        "expires_in",
        "expiresInField"
      ),
      expiresAtField: this.normalizeOptionalFieldPath(
        config.expiresAtField,
        undefined,
        "expiresAtField"
      ),
      tokenTypeField: this.normalizeOptionalFieldPath(
        config.tokenTypeField,
        "token_type",
        "tokenTypeField"
      ),
      defaultTtlSeconds: this.normalizeInteger(
        config.defaultTtlSeconds,
        DEFAULT_TOKEN_TTL_SECONDS,
        10,
        86_400,
        "defaultTtlSeconds"
      ),
      refreshBeforeSeconds: this.normalizeInteger(
        config.refreshBeforeSeconds,
        DEFAULT_TOKEN_REFRESH_BEFORE_SECONDS,
        0,
        3_600,
        "refreshBeforeSeconds"
      )
    };
    const tokenUrl = this.normalizeTokenUrl(config.tokenUrl);

    if (type === "oauth2_client_credentials") {
      const clientAuthMethod = config.clientAuthMethod ?? "body";
      if (clientAuthMethod !== "body" && clientAuthMethod !== "basic") {
        throw new AppError(ErrorCodes.common.badRequest, "clientAuthMethod is invalid");
      }
      return {
        tokenUrl,
        clientAuthMethod,
        scope: this.normalizeOptionalConfigString(config.scope, "scope", 2000),
        audience: this.normalizeOptionalConfigString(config.audience, "audience", 2000),
        ...responseConfig
      } satisfies HttpToolClientCredentialsAuthConfig;
    }

    const method = this.normalizeMethod(config.method ?? "POST");
    const contentType = config.contentType ?? "application_json";
    if (contentType !== "application_json" && contentType !== "form_urlencoded") {
      throw new AppError(ErrorCodes.common.badRequest, "token contentType is invalid");
    }
    if (method === "GET" && config.parameters && contentType !== "application_json") {
      // GET 没有请求体，contentType 仅保留默认值，避免配置让执行语义产生歧义。
      throw new AppError(
        ErrorCodes.common.badRequest,
        "GET token requests must use application_json contentType"
      );
    }

    const parameters = this.normalizeTokenParameters(config.parameters ?? []);
    if (method === "GET" && parameters.some((parameter) => parameter.location === "body")) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "GET token requests cannot declare body parameters"
      );
    }

    return {
      tokenUrl,
      method,
      contentType,
      parameters,
      headerName: this.normalizeHeaderName(
        config.headerName ?? "Authorization",
        "headerName",
        FORBIDDEN_TOKEN_HEADERS
      ),
      tokenPrefix: this.normalizeTokenPrefix(config.tokenPrefix),
      ...responseConfig
    } satisfies HttpToolCustomTokenAuthConfig;
  }

  /** 自定义 Token 参数只允许固定值或加密凭据引用，二者不能同时存在。 */
  private normalizeTokenParameters(value: unknown): HttpToolCustomTokenParameter[] {
    if (!Array.isArray(value) || value.length > 30) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "token parameters must be an array with at most 30 items"
      );
    }
    const parameters = value.map((item, index) => {
      if (!item || Array.isArray(item) || typeof item !== "object") {
        throw new AppError(ErrorCodes.common.badRequest, `token parameters[${index}] is invalid`);
      }
      const raw = item as Partial<HttpToolCustomTokenParameter>;
      const location = raw.location;
      if (location !== "header" && location !== "query" && location !== "body") {
        throw new AppError(
          ErrorCodes.common.badRequest,
          `token parameters[${index}] location is invalid`
        );
      }
      const name =
        location === "header"
          ? this.normalizeHeaderName(
              raw.name,
              `token parameters[${index}].name`,
              FORBIDDEN_TOKEN_HEADERS
            )
          : this.normalizeRequiredString(raw.name, `token parameters[${index}].name`, 100);
      const value = this.normalizeOptionalConfigString(raw.value, "token parameter value", 10_000);
      const credentialKey = raw.credentialKey
        ? this.normalizeCredentialKey(raw.credentialKey)
        : undefined;
      if ((value === undefined) === (credentialKey === undefined)) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          `${name} token parameter must set exactly one of value or credentialKey`
        );
      }
      return { name, location, ...(value !== undefined ? { value } : { credentialKey }) };
    });
    const identities = parameters.map(
      (parameter) => `${parameter.location}:${parameter.name.toLowerCase()}`
    );
    if (new Set(identities).size !== identities.length) {
      throw new AppError(ErrorCodes.common.badRequest, "token parameter names must be unique");
    }
    return parameters;
  }

  /** Token URL 可以带供应商固定 query，但不能带用户信息或 fragment。 */
  private normalizeTokenUrl(value: unknown): string {
    const raw = this.normalizeRequiredString(value, "tokenUrl", 2000);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError(ErrorCodes.common.badRequest, "tokenUrl is invalid");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new AppError(ErrorCodes.common.badRequest, "tokenUrl must be a safe http or https URL");
    }
    return url.toString();
  }

  /** 字段路径仅支持点号分隔的对象键，不执行 JSONPath 表达式。 */
  private normalizeFieldPath(value: unknown, fallback: string, name: string): string {
    const path = this.normalizeRequiredString(value ?? fallback, name, 300);
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) {
      throw new AppError(ErrorCodes.common.badRequest, `${name} is invalid`);
    }
    return path;
  }

  private normalizeOptionalFieldPath(
    value: unknown,
    fallback: string | undefined,
    name: string
  ): string | undefined {
    if (value === null || value === "") return undefined;
    if (value === undefined && fallback === undefined) return undefined;
    return this.normalizeFieldPath(value, fallback ?? "", name);
  }

  /** Header 名统一执行语法和传输层保留字段校验。 */
  private normalizeHeaderName(value: unknown, name: string, forbidden: Set<string>): string {
    const headerName = this.normalizeRequiredString(value, name, 100);
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) ||
      forbidden.has(headerName.toLowerCase())
    ) {
      throw new AppError(ErrorCodes.common.badRequest, `${name} is invalid`);
    }
    return headerName;
  }

  /** Slug 用于管理语义，运行时绑定仍使用不可变 UUID。 */
  private normalizeSlug(value: unknown): string {
    const slug = this.normalizeRequiredString(value, "slug", 80).toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "slug must start with a letter and contain lowercase letters, numbers or underscores"
      );
    }
    return slug;
  }

  /** 模型参数名限制为通用函数 Schema 可接受的标识符。 */
  private normalizeParameterName(value: unknown): string {
    const name = this.normalizeRequiredString(value, "parameter name", 80);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new AppError(ErrorCodes.common.badRequest, "parameter name is invalid");
    }
    return name;
  }

  /** 将模型字段映射到真实 HTTP 字段，允许 Header 使用连字符但仍拦截非法字符。 */
  private normalizeTargetName(
    value: unknown,
    fallback: string,
    location: HttpToolParameter["location"]
  ): string {
    const name =
      value === undefined || value === null || value === ""
        ? fallback
        : this.normalizeRequiredString(value, "targetName", 100);
    const pattern =
      location === "header" ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/ : /^[A-Za-z][A-Za-z0-9_.-]*$/;
    if (!pattern.test(name)) {
      throw new AppError(ErrorCodes.common.badRequest, `${name} targetName is invalid`);
    }
    return name;
  }

  /** 统一数值边界，防止配置绕过超时和响应上限。 */
  private normalizeInteger(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    name: string
  ): number {
    const normalized = value === undefined ? fallback : value;
    if (
      typeof normalized !== "number" ||
      !Number.isInteger(normalized) ||
      normalized < min ||
      normalized > max
    ) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `${name} must be an integer between ${min} and ${max}`
      );
    }
    return normalized;
  }

  /** 规范必填短文本并限制持久化体积。 */
  private normalizeRequiredString(value: unknown, name: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, `${name} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `${name} cannot exceed ${maxLength} characters`
      );
    }
    return normalized;
  }

  /** 规范可选描述文本。 */
  private normalizeString(value: unknown, maxLength: number): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string" || value.trim().length > maxLength) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `text cannot exceed ${maxLength} characters`
      );
    }
    return value.trim();
  }

  /** Secret 只在写入瞬间以明文存在，随后立即交给 AES-GCM 加密。 */
  private normalizeOptionalSecret(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "secret must be a string");
    }
    const normalized = value.trim();
    if (normalized.length > 10_000) {
      throw new AppError(ErrorCodes.common.badRequest, "secret is too long");
    }
    return normalized || undefined;
  }

  /** 动态凭据按键值字典校验，值不 trim，避免改变供应商密钥的真实内容。 */
  private normalizeCredentials(value: unknown): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value) || typeof value !== "object") {
      throw new AppError(ErrorCodes.common.badRequest, "credentials must be an object");
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 30) {
      throw new AppError(ErrorCodes.common.badRequest, "credentials has too many items");
    }
    return Object.fromEntries(
      entries.map(([key, credential]) => {
        const normalizedKey = this.normalizeCredentialKey(key);
        if (typeof credential !== "string" || credential.length === 0) {
          throw new AppError(
            ErrorCodes.common.badRequest,
            `${normalizedKey} credential must be a non-empty string`
          );
        }
        if (credential.length > 10_000) {
          throw new AppError(
            ErrorCodes.common.badRequest,
            `${normalizedKey} credential is too long`
          );
        }
        return [normalizedKey, credential];
      })
    );
  }

  private normalizeCredentialKey(value: unknown): string {
    const key = this.normalizeRequiredString(value, "credential key", 80);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new AppError(ErrorCodes.common.badRequest, "credential key is invalid");
    }
    return key;
  }

  /** 将静态 Secret 或动态凭据字典编码成单个加密载荷，保持数据库敏感字段不扩散。 */
  private encodeCredential(
    authType: HttpToolAuthType,
    secret: string | undefined,
    credentials: Record<string, string> | undefined,
    authConfig: HttpToolDynamicAuthConfig | null
  ): string | null {
    if (authType === "none") return null;
    if (!DYNAMIC_AUTH_TYPES.has(authType)) return secret ?? null;
    if (!credentials) return null;

    if (authType === "oauth2_client_credentials") {
      if (!credentials.clientId || !credentials.clientSecret) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          "clientId and clientSecret credentials are required"
        );
      }
    } else {
      const requiredKeys = new Set(
        (authConfig as HttpToolCustomTokenAuthConfig).parameters.flatMap((parameter) =>
          parameter.credentialKey ? [parameter.credentialKey] : []
        )
      );
      if (requiredKeys.size === 0) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          "custom token authentication requires at least one credential parameter"
        );
      }
      const missing = [...requiredKeys].filter((key) => !credentials[key]);
      if (missing.length > 0) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          `missing token credentials: ${missing.join(", ")}`
        );
      }
    }
    return JSON.stringify(credentials);
  }

  /** Runtime 内部解密动态凭据，解析失败时明确阻止调用，避免误把密文格式当 Token。 */
  private decodeRuntimeCredential(
    authType: HttpToolAuthType,
    decrypted: string | null
  ): Pick<HttpToolRuntimeConfig, "secret" | "credentials"> {
    if (!DYNAMIC_AUTH_TYPES.has(authType)) {
      return { secret: decrypted, credentials: {} };
    }
    if (!decrypted) return { secret: null, credentials: {} };
    try {
      const parsed = JSON.parse(decrypted) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      const credentials = this.normalizeCredentials(parsed);
      return { secret: null, credentials: credentials ?? {} };
    } catch {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "dynamic authentication credentials are invalid"
      );
    }
  }

  /** 管理详情仅回显动态凭据键名，帮助编辑表单表达“已配置”而不泄漏值。 */
  private readCredentialKeys(tool: HttpToolWithSecret): string[] {
    if (!DYNAMIC_AUTH_TYPES.has(tool.authType as HttpToolAuthType) || !tool.secret) return [];
    const decrypted = decryptSecret(tool.secret.encryptedValue);
    return Object.keys(
      this.decodeRuntimeCredential(tool.authType as HttpToolAuthType, decrypted).credentials
    ).sort();
  }

  private normalizeOptionalConfigString(
    value: unknown,
    name: string,
    maxLength: number
  ): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || value.length > maxLength) {
      throw new AppError(ErrorCodes.common.badRequest, `${name} is invalid`);
    }
    return value;
  }

  /** 自定义注入允许显式空前缀，此时 Header 值就是 Token 本身。 */
  private normalizeTokenPrefix(value: unknown): string {
    if (value === undefined || value === null) return "Bearer";
    if (typeof value !== "string" || value.length > 100 || /[\r\n]/.test(value)) {
      throw new AppError(ErrorCodes.common.badRequest, "tokenPrefix is invalid");
    }
    return value.trim();
  }

  /** Slug 全局唯一，包含软删除记录，避免审计语义被新工具复用。 */
  private async ensureSlugAvailable(slug: string, excludedId?: string): Promise<void> {
    const existing = await this.prisma.httpTool.findFirst({
      where: { slug, ...(excludedId ? { id: { not: excludedId } } : {}) }
    });
    if (existing) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "http tool slug already exists",
        HttpStatus.CONFLICT
      );
    }
  }

  /** 管理查询统一排除软删除记录并加载凭据配置状态。 */
  private async findHttpTool(id: string): Promise<HttpToolWithSecret> {
    const tool = await this.prisma.httpTool.findFirst({
      where: { id, deletedAt: null },
      include: { secret: true }
    });
    if (!tool) {
      throw new AppError(ErrorCodes.common.notFound, "http tool not found", HttpStatus.NOT_FOUND);
    }
    return tool;
  }

  /** 数据库配置转换为模型可见定义，不包含网络和鉴权字段。 */
  private toDefinition(tool: HttpTool): ToolDefinition {
    return {
      id: this.toRuntimeId(tool.id),
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      inputSchema: this.buildInputSchema(this.readParameters(tool.parameters))
    };
  }

  /** 从业务参数声明构造严格 JSON Schema。 */
  private buildInputSchema(parameters: HttpToolParameter[]): ToolInputSchema {
    return {
      type: "object",
      properties: Object.fromEntries(
        parameters.map((parameter) => [
          parameter.name,
          {
            type: parameter.type,
            description: parameter.description,
            ...(parameter.defaultValue !== undefined ? { default: parameter.defaultValue } : {})
          }
        ])
      ),
      required: parameters
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name),
      additionalProperties: false
    };
  }

  /** 列表 DTO 只暴露 Secret 是否存在。 */
  private toListItem(tool: HttpToolWithSecret): HttpToolListItem {
    return {
      id: tool.id,
      runtimeId: this.toRuntimeId(tool.id),
      name: tool.name,
      slug: tool.slug,
      description: tool.description,
      enabled: tool.enabled,
      method: tool.method as HttpToolMethod,
      baseUrl: tool.baseUrl,
      path: tool.path,
      authType: tool.authType as HttpToolAuthType,
      secretConfigured: Boolean(tool.secret),
      allowPrivateNetwork: tool.allowPrivateNetwork,
      updatedAt: tool.updatedAt
    };
  }

  /** 详情 DTO 回显非敏感配置和模型输入 Schema。 */
  private toDetail(tool: HttpToolWithSecret): HttpToolDetail {
    const parameters = this.readParameters(tool.parameters);
    return {
      ...this.toListItem(tool),
      parameters,
      fixedHeaders: this.readFixedHeaders(tool.fixedHeaders),
      authHeaderName: tool.authHeaderName,
      authConfig: this.readAuthConfig(tool.authType as HttpToolAuthType, tool.authConfig),
      credentialKeys: this.readCredentialKeys(tool),
      timeoutMs: tool.timeoutMs,
      maxResponseBytes: tool.maxResponseBytes,
      inputSchema: this.buildInputSchema(parameters),
      createdAt: tool.createdAt
    };
  }

  /** Prisma Json 解包为已在写入时验证过的参数声明。 */
  private readParameters(value: Prisma.JsonValue): HttpToolParameter[] {
    return Array.isArray(value) ? (value as unknown as HttpToolParameter[]) : [];
  }

  /** Prisma Json 解包为固定 Header 列表。 */
  private readFixedHeaders(value: Prisma.JsonValue): HttpToolFixedHeader[] {
    return Array.isArray(value) ? (value as unknown as HttpToolFixedHeader[]) : [];
  }

  /** Prisma Json 在保存时已完成结构校验；旧静态鉴权记录统一返回 null。 */
  private readAuthConfig(
    authType: HttpToolAuthType,
    value: Prisma.JsonValue
  ): HttpToolDynamicAuthConfig | null {
    if (!DYNAMIC_AUTH_TYPES.has(authType)) return null;
    if (!value || Array.isArray(value) || typeof value !== "object") return null;
    return value as unknown as HttpToolDynamicAuthConfig;
  }

  /** 稳定前缀让 Tool Loop 区分内置与数据库工具，并兼容模型函数名。 */
  private toRuntimeId(id: string): string {
    return `${HTTP_TOOL_PREFIX}${id}`;
  }
}
