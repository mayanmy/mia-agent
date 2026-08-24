export type McpAuthTypeValue = "none" | "bearer" | "api_key_header" | "client_credentials";
export type McpApprovalModeValue = "auto" | "confirm" | "disabled";
export type McpRiskLevelValue = "low" | "medium" | "high";

export type McpServerCreateDto = {
  name: string;
  slug: string;
  description?: string;
  endpoint: string;
  authType?: McpAuthTypeValue;
  authConfig?: Record<string, unknown>;
  secret?: string;
  enabled?: boolean;
  allowPrivateNetwork?: boolean;
  approvalMode?: McpApprovalModeValue;
  connectTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxResponseBytes?: number;
  maxOutputChars?: number;
  maxConcurrency?: number;
};

export type McpServerUpdateDto = Partial<McpServerCreateDto> & {
  clearSecret?: boolean;
};

export type McpServerListItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  endpoint: string;
  authType: McpAuthTypeValue;
  authConfig: Record<string, unknown>;
  secretConfigured: boolean;
  enabled: boolean;
  allowPrivateNetwork: boolean;
  approvalMode: McpApprovalModeValue;
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

export type McpServerToolUpdateDto = {
  enabled?: boolean;
  approvalMode?: McpApprovalModeValue | null;
  riskLevel?: McpRiskLevelValue;
};

export type McpServerToolDetail = {
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
  approvalMode?: McpApprovalModeValue;
  riskLevel: McpRiskLevelValue;
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

export type McpSyncRunListItem = {
  id: string;
  status: string;
  trigger: string;
  toolCount: number;
  schemaChangedCount: number;
  errorCode?: string;
  errorMessage?: string;
  elapsedMs?: number;
  createdAt: string;
  completedAt?: string;
};
