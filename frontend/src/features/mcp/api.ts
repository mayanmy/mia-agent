import { request } from "../../shared/api/client";

export type McpAuthType = "none" | "bearer" | "api_key_header" | "client_credentials";
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
  enabled: boolean;
  allowPrivateNetwork: boolean;
  approvalMode: McpApprovalMode;
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
};

export type McpServerPayload = Omit<McpServerFormValues, "headerName"> & {
  authConfig: Record<string, unknown>;
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

export function updateMcpServer(
  id: string,
  payload: McpServerPayload
): Promise<McpServerDetail> {
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

export function syncMcpTools(id: string): Promise<McpSyncResult> {
  return request<McpSyncResult>(`/api/v1/mcp/servers/${id}/sync-tools`, {
    method: "POST"
  });
}

export function listMcpServerTools(id: string): Promise<McpServerTool[]> {
  return request<McpServerTool[]>(`/api/v1/mcp/servers/${id}/tools`);
}

export function updateMcpServerTool(
  serverId: string,
  toolId: string,
  payload: Pick<McpServerTool, "enabled" | "riskLevel"> & {
    approvalMode?: McpApprovalMode | null;
  }
): Promise<McpServerTool> {
  return request<McpServerTool>(`/api/v1/mcp/servers/${serverId}/tools/${toolId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
