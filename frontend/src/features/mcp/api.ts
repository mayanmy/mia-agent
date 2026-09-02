import { request } from "../../shared/api/client";

export type McpAuthType = "none" | "bearer" | "api_key_header" | "client_credentials" | "oauth";
export type McpApprovalMode = "auto" | "confirm" | "disabled";
export type McpRiskLevel = "low" | "medium" | "high";

export type McpServerFormValues = {
  name: string;
  slug: string;
  description?: string;
  endpoint: string;
  authType: McpAuthType;
  secret?: string;
  headerName?: string;
  tokenUrl?: string;
  clientAuthMethod?: "body" | "basic" | "none" | "client_secret_basic" | "client_secret_post";
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  defaultTtlSeconds?: number;
  refreshBeforeSeconds?: number;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  approvalMode: McpApprovalMode;
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
};

export type McpServerPayload = Omit<
  McpServerFormValues,
  | "headerName"
  | "tokenUrl"
  | "clientAuthMethod"
  | "clientId"
  | "clientSecret"
  | "scope"
  | "audience"
  | "defaultTtlSeconds"
  | "refreshBeforeSeconds"
> & {
  authConfig: Record<string, unknown>;
  credentials?: Record<string, string>;
};

export type McpServerListItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  endpoint: string;
  authType: McpAuthType;
  authConfig: Record<string, unknown>;
  secretConfigured: boolean;
  oauthAuthorized: boolean;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  approvalMode: McpApprovalMode;
  healthStatus: string;
  protocolVersion?: string;
  toolCount: number;
  enabledToolCount: number;
  lastConnectedAt?: string;
  lastDiscoveredAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type McpServerDetail = McpServerListItem & {
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

export type McpConnectionTestResult = {
  ok: boolean;
  healthStatus: string;
  protocolVersion?: string;
  toolCount?: number;
  elapsedMs: number;
  errorMessage?: string;
};

export type McpServerTool = {
  id: string;
  serverId: string;
  remoteName: string;
  runtimeId: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled: boolean;
  approvalMode?: McpApprovalMode;
  riskLevel: McpRiskLevel;
  sensitiveInputPaths: string[];
  sensitiveOutputPaths: string[];
  available: boolean;
  schemaHash: string;
  lastSeenAt: string;
};

export type McpSyncResult = {
  syncRunId: string;
  status: "completed" | "failed";
  toolCount: number;
  schemaChangedCount: number;
  elapsedMs: number;
  errorMessage?: string;
};

export type McpResourceItem = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

export type McpResourceTemplateItem = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpResourceCatalog = {
  resources: McpResourceItem[];
  templates: McpResourceTemplateItem[];
};

export type McpResourcePreview = {
  uri: string;
  mimeType: string;
  text: string;
  truncated: boolean;
  originalChars: number;
};

export type McpPromptArgument = { name: string; description?: string; required: boolean };
export type McpPromptItem = {
  name: string;
  title?: string;
  description?: string;
  arguments: McpPromptArgument[];
};
export type McpPromptCatalog = { prompts: McpPromptItem[] };
export type McpPromptPreview = {
  name: string;
  description?: string;
  text: string;
  messageCount: number;
};

export function listMcpServers(): Promise<McpServerListItem[]> {
  return request<McpServerListItem[]>("/api/v1/mcp/servers");
}

export function getMcpServer(id: string): Promise<McpServerDetail> {
  return request<McpServerDetail>(`/api/v1/mcp/servers/${id}`);
}

export function createMcpServer(payload: McpServerPayload): Promise<McpServerDetail> {
  return request<McpServerDetail>("/api/v1/mcp/servers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMcpServer(id: string, payload: McpServerPayload): Promise<McpServerDetail> {
  return request<McpServerDetail>(`/api/v1/mcp/servers/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteMcpServer(id: string): Promise<null> {
  return request<null>(`/api/v1/mcp/servers/${id}`, { method: "DELETE" });
}

export function testMcpConnection(id: string): Promise<McpConnectionTestResult> {
  return request<McpConnectionTestResult>(`/api/v1/mcp/servers/${id}/test`, {
    method: "POST"
  });
}

export function startMcpOAuth(
  id: string
): Promise<{ authorizationUrl: string; expiresAt: string }> {
  return request<{ authorizationUrl: string; expiresAt: string }>(
    `/api/v1/mcp/servers/${id}/oauth/authorize`,
    { method: "POST" }
  );
}

export function revokeMcpOAuth(id: string): Promise<null> {
  return request<null>(`/api/v1/mcp/servers/${id}/oauth/authorization`, {
    method: "DELETE"
  });
}

export function syncMcpTools(id: string): Promise<McpSyncResult> {
  return request<McpSyncResult>(`/api/v1/mcp/servers/${id}/sync-tools`, {
    method: "POST"
  });
}

export function listMcpServerTools(id: string): Promise<McpServerTool[]> {
  return request<McpServerTool[]>(`/api/v1/mcp/servers/${id}/tools`);
}

export function listMcpResources(id: string): Promise<McpResourceCatalog> {
  return request<McpResourceCatalog>(`/api/v1/mcp/servers/${id}/resources`);
}

export function previewMcpResource(id: string, uri: string): Promise<McpResourcePreview> {
  return request<McpResourcePreview>(`/api/v1/mcp/servers/${id}/resources/preview`, {
    method: "POST",
    body: JSON.stringify({ uri })
  });
}

export function importMcpResource(
  id: string,
  payload: { uri: string; knowledgeBaseId: string; filename?: string }
): Promise<{ resourceUri: string; document: { id: string; originalFilename: string } }> {
  return request(`/api/v1/mcp/servers/${id}/resources/import`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function listMcpPrompts(id: string): Promise<McpPromptCatalog> {
  return request<McpPromptCatalog>(`/api/v1/mcp/servers/${id}/prompts`);
}

export function previewMcpPrompt(
  id: string,
  name: string,
  args: Record<string, string>
): Promise<McpPromptPreview> {
  return request<McpPromptPreview>(`/api/v1/mcp/servers/${id}/prompts/preview`, {
    method: "POST",
    body: JSON.stringify({ name, arguments: args })
  });
}

export function importMcpPrompt(
  id: string,
  payload: { name: string; arguments: Record<string, string>; skillName?: string }
): Promise<{ promptName: string; skill: { id: string; name: string; enabled: boolean } }> {
  return request(`/api/v1/mcp/servers/${id}/prompts/import`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateMcpServerTool(
  serverId: string,
  toolId: string,
  payload: Pick<
    McpServerTool,
    "enabled" | "riskLevel" | "sensitiveInputPaths" | "sensitiveOutputPaths"
  > & {
    approvalMode?: McpApprovalMode | null;
  }
): Promise<McpServerTool> {
  return request<McpServerTool>(`/api/v1/mcp/servers/${serverId}/tools/${toolId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
