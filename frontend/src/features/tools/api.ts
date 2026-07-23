import { request } from "../../shared/api/client";

export type ToolListItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type HttpToolMethod = "GET" | "POST";
export type HttpToolAuthType =
  "none" | "bearer" | "api_key_header" | "oauth2_client_credentials" | "custom_token";
export type HttpToolParameter = {
  name: string;
  targetName?: string;
  description: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  location: "path" | "query" | "header" | "body";
  required: boolean;
  sensitive?: boolean;
};
export type HttpToolFixedHeader = { name: string; value: string };
export type HttpToolTokenParameter = {
  name: string;
  location: "header" | "query" | "body";
  value?: string;
  credentialKey?: string;
};
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
export type HttpToolCredentialEntry = { key: string; value?: string };

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

export type HttpToolDetail = HttpToolListItem &
  Omit<HttpToolFormValues, "secret" | "clientId" | "clientSecret" | "credentialEntries"> & {
    authHeaderName: string | null;
    credentialKeys: string[];
    createdAt: string;
  };

export type HttpToolPayload = Omit<
  HttpToolFormValues,
  "clientId" | "clientSecret" | "credentialEntries"
> & {
  credentials?: Record<string, string>;
};

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
