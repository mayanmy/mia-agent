import { ToolInputSchema, ToolJsonValue } from "./tool.dto";

export type HttpToolMethod = "GET" | "POST";
export type HttpToolParameterType = "string" | "number" | "boolean" | "object" | "array";
export type HttpToolParameterLocation = "path" | "query" | "header" | "body";
export type HttpToolAuthType =
  "none" | "bearer" | "api_key_header" | "oauth2_client_credentials" | "custom_token";

export type HttpToolTokenContentType = "application_json" | "form_urlencoded";
export type HttpToolClientAuthMethod = "body" | "basic";

export type HttpToolTokenResponseConfig = {
  tokenField: string;
  expiresInField?: string;
  expiresAtField?: string;
  tokenTypeField?: string;
  defaultTtlSeconds: number;
  refreshBeforeSeconds: number;
};

export type HttpToolClientCredentialsAuthConfig = HttpToolTokenResponseConfig & {
  tokenUrl: string;
  clientAuthMethod: HttpToolClientAuthMethod;
  scope?: string;
  audience?: string;
};

export type HttpToolCustomTokenParameter = {
  name: string;
  location: "header" | "query" | "body";
  value?: string;
  credentialKey?: string;
};

export type HttpToolCustomTokenAuthConfig = HttpToolTokenResponseConfig & {
  tokenUrl: string;
  method: HttpToolMethod;
  contentType: HttpToolTokenContentType;
  parameters: HttpToolCustomTokenParameter[];
  headerName: string;
  tokenPrefix: string;
};

export type HttpToolDynamicAuthConfig =
  HttpToolClientCredentialsAuthConfig | HttpToolCustomTokenAuthConfig;

export type HttpToolParameter = {
  name: string;
  targetName?: string;
  description: string;
  type: HttpToolParameterType;
  location: HttpToolParameterLocation;
  required: boolean;
  sensitive?: boolean;
  defaultValue?: ToolJsonValue;
};

export type HttpToolFixedHeader = {
  name: string;
  value: string;
};

export type HttpToolCreateDto = {
  name: string;
  slug: string;
  description?: string;
  enabled?: boolean;
  method: HttpToolMethod;
  baseUrl: string;
  path: string;
  parameters?: HttpToolParameter[];
  fixedHeaders?: HttpToolFixedHeader[];
  authType?: HttpToolAuthType;
  authHeaderName?: string;
  secret?: string;
  authConfig?: Partial<HttpToolDynamicAuthConfig>;
  /** 动态鉴权凭据为 write-only 字典，管理 API 永不回显值。 */
  credentials?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowPrivateNetwork?: boolean;
};

export type HttpToolUpdateDto = Partial<HttpToolCreateDto>;

export type HttpToolListItem = {
  id: string;
  runtimeId: string;
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  method: HttpToolMethod;
  baseUrl: string;
  path: string;
  authType: HttpToolAuthType;
  secretConfigured: boolean;
  allowPrivateNetwork: boolean;
  updatedAt: Date;
};

export type HttpToolDetail = HttpToolListItem & {
  parameters: HttpToolParameter[];
  fixedHeaders: HttpToolFixedHeader[];
  authHeaderName: string | null;
  authConfig: HttpToolDynamicAuthConfig | null;
  credentialKeys: string[];
  timeoutMs: number;
  maxResponseBytes: number;
  inputSchema: ToolInputSchema;
  createdAt: Date;
};

export type HttpToolTestDto = {
  input?: Record<string, ToolJsonValue>;
};

export type HttpToolTestResult = {
  ok: boolean;
  output?: ToolJsonValue;
  errorType?: string;
  errorMessage?: string;
  elapsedMs: number;
};

/** Executor 只接收已验证配置，避免网络层再次理解 Prisma 实体。 */
export type HttpToolRuntimeConfig = {
  id: string;
  method: HttpToolMethod;
  baseUrl: string;
  path: string;
  parameters: HttpToolParameter[];
  fixedHeaders: HttpToolFixedHeader[];
  authType: HttpToolAuthType;
  authHeaderName: string | null;
  secret: string | null;
  authConfig: HttpToolDynamicAuthConfig | null;
  credentials: Record<string, string>;
  /** 配置更新时间进入缓存键，保存配置后不会继续复用旧 Token。 */
  tokenCacheKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  allowPrivateNetwork: boolean;
};
