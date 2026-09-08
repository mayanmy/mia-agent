import { request } from "../../shared/api/client";

/** 工具列表统一展示的轻量摘要。 */
export type ToolListItem = {
  /** Runtime 使用的稳定工具 ID。 */
  id: string;
  /** 工具展示名称。 */
  name: string;
  /** 提供给管理员和模型的用途说明。 */
  description: string;
  /** 是否允许 Agent 绑定。 */
  enabled: boolean;
  /** 前端分组来源；后端普通工具缺省为 standard。 */
  source?: "standard" | "workflow";
  /** Workflow Tool 固定绑定的版本号。 */
  workflowVersion?: number;
};

/** HTTP 工具 V1 允许的请求方法。 */
export type HttpToolMethod = "GET" | "POST";
/** HTTP 工具支持的静态和动态鉴权方式。 */
export type HttpToolAuthType =
  "none" | "bearer" | "api_key_header" | "oauth2_client_credentials" | "custom_token";
/** 模型参数到 HTTP 请求位置的映射。 */
export type HttpToolParameter = {
  name: string;
  targetName?: string;
  description: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  location: "path" | "query" | "header" | "body";
  required: boolean;
  sensitive?: boolean;
};
/** 管理员配置且模型不能覆盖的固定 Header。 */
export type HttpToolFixedHeader = { name: string; value: string };
/** 自定义 Token 请求中的固定值或凭据引用。 */
export type HttpToolTokenParameter = {
  name: string;
  location: "header" | "query" | "body";
  value?: string;
  credentialKey?: string;
};
/** 前端展开编辑的动态 Token 鉴权配置。 */
export type HttpToolAuthConfig = {
  tokenUrl?: string;
  clientAuthMethod?: "body" | "basic";
  scope?: string;
  audience?: string;
  method?: HttpToolMethod;
  contentType?: "application_json" | "form_urlencoded";
  parameters?: HttpToolTokenParameter[];
  tokenField?: string;
  expiresInField?: string;
  expiresAtField?: string;
  tokenTypeField?: string;
  headerName?: string;
  tokenPrefix?: string;
  defaultTtlSeconds?: number;
  refreshBeforeSeconds?: number;
};
/** 只写凭据表单行；详情接口只回传 key。 */
export type HttpToolCredentialEntry = { key: string; value?: string };

/** HTTP 工具创建/编辑表单的展开字段。 */
export type HttpToolFormValues = {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  method: HttpToolMethod;
  baseUrl: string;
  path: string;
  parameters: HttpToolParameter[];
  fixedHeaders: HttpToolFixedHeader[];
  authType: HttpToolAuthType;
  authHeaderName?: string;
  secret?: string;
  authConfig?: HttpToolAuthConfig;
  clientId?: string;
  clientSecret?: string;
  credentialEntries?: HttpToolCredentialEntry[];
  timeoutMs: number;
  maxResponseBytes: number;
  allowPrivateNetwork: boolean;
};

/** HTTP 工具管理列表的安全摘要。 */
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
  updatedAt: string;
};

/** HTTP 工具详情和已配置凭据键，不包含凭据值。 */
export type HttpToolDetail = HttpToolListItem &
  Omit<HttpToolFormValues, "secret" | "clientId" | "clientSecret" | "credentialEntries"> & {
    authHeaderName: string | null;
    credentialKeys: string[];
    createdAt: string;
  };

/** 将表单凭据行归一化后的 HTTP 工具请求结构。 */
export type HttpToolPayload = Omit<
  HttpToolFormValues,
  "clientId" | "clientSecret" | "credentialEntries"
> & {
  credentials?: Record<string, string>;
};

/** HTTP 工具测试的统一结果。 */
export type HttpToolTestResult = {
  ok: boolean;
  output?: unknown;
  errorType?: string;
  errorMessage?: string;
  elapsedMs: number;
};

export function listTools(): Promise<ToolListItem[]> {
  return request<ToolListItem[]>("/api/v1/tools");
}

export function listHttpTools(): Promise<HttpToolListItem[]> {
  return request<HttpToolListItem[]>("/api/v1/tools/http");
}

export function getHttpTool(id: string): Promise<HttpToolDetail> {
  return request<HttpToolDetail>(`/api/v1/tools/http/${id}`);
}

export function createHttpTool(payload: HttpToolPayload): Promise<HttpToolDetail> {
  return request<HttpToolDetail>("/api/v1/tools/http", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateHttpTool(id: string, payload: HttpToolPayload): Promise<HttpToolDetail> {
  return request<HttpToolDetail>(`/api/v1/tools/http/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteHttpTool(id: string): Promise<null> {
  return request<null>(`/api/v1/tools/http/${id}`, { method: "DELETE" });
}

export function testHttpTool(
  id: string,
  input: Record<string, unknown>
): Promise<HttpToolTestResult> {
  return request<HttpToolTestResult>(`/api/v1/tools/http/${id}/test`, {
    method: "POST",
    body: JSON.stringify({ input })
  });
}
