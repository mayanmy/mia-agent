import { ToolInputSchema, ToolJsonValue } from "./tool.dto";

/** HTTP 工具 V1 允许的请求方法白名单。 */
export type HttpToolMethod = "GET" | "POST";
/** HTTP 工具参数可声明的 JSON 数据类型。 */
export type HttpToolParameterType = "string" | "number" | "boolean" | "object" | "array";
/** 参数写入 URL、Header 或 Body 的目标位置。 */
export type HttpToolParameterLocation = "path" | "query" | "header" | "body";
/** HTTP 工具支持的静态与动态鉴权方式。 */
export type HttpToolAuthType =
  "none" | "bearer" | "api_key_header" | "oauth2_client_credentials" | "custom_token";

/** 动态 Token 端点支持的请求编码。 */
export type HttpToolTokenContentType = "application_json" | "form_urlencoded";
/** Client Credentials 向 Token 端点传递客户端凭据的方式。 */
export type HttpToolClientAuthMethod = "body" | "basic";

/** 从动态 Token 响应中提取令牌和有效期的规则。 */
export type HttpToolTokenResponseConfig = {
  tokenField: string;
  expiresInField?: string;
  expiresAtField?: string;
  tokenTypeField?: string;
  defaultTtlSeconds: number;
  refreshBeforeSeconds: number;
};

/** 标准 OAuth Client Credentials 鉴权配置。 */
export type HttpToolClientCredentialsAuthConfig = HttpToolTokenResponseConfig & {
  tokenUrl: string;
  clientAuthMethod: HttpToolClientAuthMethod;
  scope?: string;
  audience?: string;
};

/** 自定义 Token 请求中额外发送的固定参数。 */
export type HttpToolCustomTokenParameter = {
  name: string;
  location: "header" | "query" | "body";
  value?: string;
  credentialKey?: string;
};

/** 非标准 Token 端点的受控请求配置。 */
export type HttpToolCustomTokenAuthConfig = HttpToolTokenResponseConfig & {
  tokenUrl: string;
  method: HttpToolMethod;
  contentType: HttpToolTokenContentType;
  parameters: HttpToolCustomTokenParameter[];
  headerName: string;
  tokenPrefix: string;
};

/** HTTP 工具动态鉴权配置的判别联合。 */
export type HttpToolDynamicAuthConfig =
  HttpToolClientCredentialsAuthConfig | HttpToolCustomTokenAuthConfig;

/** 模型工具参数到 HTTP 请求位置的映射规则。 */
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

/** 管理员配置且不允许模型覆盖的固定 Header。 */
export type HttpToolFixedHeader = {
  name: string;
  value: string;
};

/** 创建 HTTP 工具的输入；凭据字段均为只写。 */
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

/** 更新 HTTP 工具的输入；未提供字段保持原值。 */
export type HttpToolUpdateDto = Partial<HttpToolCreateDto>;

/** HTTP 工具管理列表的安全摘要。 */
export type HttpToolListItem = {
  id: string;
  /** 创建者摘要，用于区分成员自己的工具。 */
  creator: {
    id: string;
    displayName: string;
  };
  /** 当前成员可执行的管理操作，由服务端计算。 */
  permissions: {
    canEdit: boolean;
    canDelete: boolean;
    canTest: boolean;
    canEnablePrivateNetwork: boolean;
  };
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

/** HTTP 工具详情及运行限制，不回显凭据值。 */
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

/** 管理端测试 HTTP 工具时提供的模型输入。 */
export type HttpToolTestDto = {
  input?: Record<string, ToolJsonValue>;
};

/** HTTP 工具测试的统一结果。 */
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
