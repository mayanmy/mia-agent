import { request } from "../../shared/api/client";

/** MCP Server 支持的认证方式。 */
export type McpAuthType = "none" | "bearer" | "api_key_header" | "client_credentials" | "oauth";
/** 工具默认执行策略；confirm 需要成员交互审批。 */
export type McpApprovalMode = "auto" | "confirm" | "disabled";
/** 工具风险等级，用于管理端提示和审批策略。 */
export type McpRiskLevel = "low" | "medium" | "high";

/** MCP Server 创建/编辑表单的展开字段。 */
export type McpServerFormValues = {
  name: string;
  slug: string;
  description?: string;
  endpoint: string;
  authType: McpAuthType;
  /** 通用静态凭据，只写且不从详情接口回填。 */
  secret?: string;
  headerName?: string;
  tokenUrl?: string;
  clientAuthMethod?: "body" | "basic" | "none" | "client_secret_basic" | "client_secret_post";
  clientId?: string;
  /** OAuth/Client Credentials 密钥，只写且不回显。 */
  clientSecret?: string;
  scope?: string;
  audience?: string;
  defaultTtlSeconds?: number;
  refreshBeforeSeconds?: number;
  enabled: boolean;
  /** 是否允许访问私网地址；开启前需管理员明确评估 SSRF 风险。 */
  allowPrivateNetwork: boolean;
  approvalMode: McpApprovalMode;
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
};

/** 将表单认证字段归一化为后端 authConfig 与凭据字典的请求结构。 */
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
  /** 不含秘密值的认证协议配置。 */
  authConfig: Record<string, unknown>;
  /** 仅写入的命名凭据字典。 */
  credentials?: Record<string, string>;
};

/** MCP Server 列表中的连接、授权和工具摘要。 */
export type McpServerListItem = {
  id: string;
  name: string;
  slug: string;
  description: string;
  endpoint: string;
  authType: McpAuthType;
  authConfig: Record<string, unknown>;
  /** 仅表示已经配置静态秘密，不包含原值。 */
  secretConfigured: boolean;
  /** OAuth 授权是否仍然有效。 */
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

/** MCP 连接探测结果。 */
export type McpConnectionTestResult = {
  ok: boolean;
  healthStatus: string;
  protocolVersion?: string;
  toolCount?: number;
  elapsedMs: number;
  errorMessage?: string;
};

/** MCP Server 同步到本地目录的单个工具。 */
export type McpServerTool = {
  id: string;
  serverId: string;
  remoteName: string;
  /** 运行时全局唯一 ID，模型调用和日志使用该值。 */
  runtimeId: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled: boolean;
  /** 工具级覆盖审批策略；缺失时沿用 Server。 */
  approvalMode?: McpApprovalMode;
  riskLevel: McpRiskLevel;
  /** 输入中必须脱敏的 JSON Pointer/路径集合。 */
  sensitiveInputPaths: string[];
  /** 输出中必须脱敏的 JSON Pointer/路径集合。 */
  sensitiveOutputPaths: string[];
  available: boolean;
  schemaHash: string;
  lastSeenAt: string;
};

/** MCP 工具管理页的局部更新；approvalMode=null 表示清除覆盖并继承 Server。 */
export type McpServerToolChanges = Omit<Partial<McpServerTool>, "approvalMode"> & {
  approvalMode?: McpApprovalMode | null;
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

/** MCP Server 暴露的静态资源目录项。 */
export type McpResourceItem = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

/** MCP Server 暴露的参数化资源模板。 */
export type McpResourceTemplateItem = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

/** MCP 资源与模板的合并目录。 */
export type McpResourceCatalog = {
  resources: McpResourceItem[];
  templates: McpResourceTemplateItem[];
};

/** 受大小限制的 MCP 资源预览。 */
export type McpResourcePreview = {
  uri: string;
  mimeType: string;
  text: string;
  /** 是否因前端可展示上限而截断。 */
  truncated: boolean;
  originalChars: number;
};

/** MCP Prompt 声明的单个参数。 */
export type McpPromptArgument = { name: string; description?: string; required: boolean };
/** MCP Server 暴露的 Prompt 目录项。 */
export type McpPromptItem = {
  name: string;
  title?: string;
  description?: string;
  arguments: McpPromptArgument[];
};
/** MCP Prompt 列表响应。 */
export type McpPromptCatalog = { prompts: McpPromptItem[] };
/** MCP Prompt 渲染后的文本预览。 */
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
    /** null 表示清除工具级覆盖并重新继承 Server 策略。 */
    approvalMode?: McpApprovalMode | null;
  }
): Promise<McpServerTool> {
  return request<McpServerTool>(`/api/v1/mcp/servers/${serverId}/tools/${toolId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
