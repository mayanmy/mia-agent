/** MCP Server 支持的认证方式。 */
export type McpAuthTypeValue =
  "none" | "bearer" | "api_key_header" | "client_credentials" | "oauth";
/** MCP 工具默认执行策略；confirm 需要成员交互审批。 */
export type McpApprovalModeValue = "auto" | "confirm" | "disabled";
/** MCP 工具风险等级。 */
export type McpRiskLevelValue = "low" | "medium" | "high";

/** 创建 MCP Server 的输入；Secret 和 credentials 均为只写。 */
export type McpServerCreateDto = {
  name: string;
  slug: string;
  description?: string;
  endpoint: string;
  authType?: McpAuthTypeValue;
  authConfig?: Record<string, unknown>;
  secret?: string;
  /** 动态鉴权凭据独立于公开 authConfig，Service 会整体加密后再持久化。 */
  credentials?: Record<string, string>;
  enabled?: boolean;
  allowPrivateNetwork?: boolean;
  approvalMode?: McpApprovalModeValue;
  connectTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxResponseBytes?: number;
  maxOutputChars?: number;
  maxConcurrency?: number;
};

/** 更新 MCP Server 的输入；clearSecret 用于显式删除旧凭据。 */
export type McpServerUpdateDto = Partial<McpServerCreateDto> & {
  clearSecret?: boolean;
};

/** MCP Server 管理列表的安全连接摘要。 */
export type McpServerListItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  endpoint: string;
  authType: McpAuthTypeValue;
  authConfig: Record<string, unknown>;
  secretConfigured: boolean;
  oauthAuthorized: boolean;
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

/** MCP Server 详情及运行限制和协议能力。 */
export type McpServerDetail = McpServerListItem & {
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

/** MCP Server 连接测试结果。 */
export type McpConnectionTestResult = {
  ok: boolean;
  healthStatus: string;
  protocolVersion?: string;
  toolCount?: number;
  elapsedMs: number;
  errorMessage?: string;
};

/** 发起 OAuth PKCE 授权后返回给管理端的跳转信息。 */
export type McpOAuthStartResponse = {
  authorizationUrl: string;
  expiresAt: string;
};

/** 更新单个 MCP 工具启用、风险和脱敏策略的输入。 */
export type McpServerToolUpdateDto = {
  enabled?: boolean;
  approvalMode?: McpApprovalModeValue | null;
  riskLevel?: McpRiskLevelValue;
  sensitiveInputPaths?: string[];
  sensitiveOutputPaths?: string[];
};

/** MCP Server Tool 的本地快照和可用状态。 */
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
  sensitiveInputPaths: string[];
  sensitiveOutputPaths: string[];
  available: boolean;
  schemaHash: string;
  lastSeenAt: string;
};

/** MCP 工具目录同步结果。 */
export type McpSyncResult = {
  syncRunId: string;
  status: "completed" | "failed";
  toolCount: number;
  schemaChangedCount: number;
  elapsedMs: number;
  errorMessage?: string;
};

/** MCP 历史同步任务列表项。 */
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
