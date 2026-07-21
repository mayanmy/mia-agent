import { request, type PageResult } from "../../shared/api/client";
import type { ModelProviderType } from "../model-providers/api";

export type AgentGenerationParams = Record<string, string | number | boolean | null>;
export type AgentChatSessionMode = "EPHEMERAL" | "PERSISTENT";

export type AgentListItem = {
  id: string;
  name: string;
  description: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  toolCount: number;
  knowledgeBaseCount: number;
  temperature: number;
  chatSessionMode: AgentChatSessionMode;
  enabled: boolean;
  published: boolean;
  publishedAt: string | null;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentModelConfigSummary = {
  id: string;
  modelName: string;
  modelType: "CHAT" | "EMBEDDING";
  providerId: string;
  providerName: string;
  providerType: ModelProviderType;
};

export type AgentDetail = AgentListItem & {
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  chatSessionMode: AgentChatSessionMode;
  generationParams: AgentGenerationParams | null;
  toolIds: string[];
  knowledgeBaseIds: string[];
  modelConfig: AgentModelConfigSummary;
};

export type AgentPayload = {
  name: string;
  description: string;
  systemPrompt: string;
  modelConfigId: string;
  temperature: number;
  maxTokens: number | null;
  historyTurns: number;
  chatSessionMode: AgentChatSessionMode;
  enabled: boolean;
};

export function listAgents(page = 1, pageSize = 20): Promise<PageResult<AgentListItem>> {
  return request<PageResult<AgentListItem>>(`/api/v1/agents?page=${page}&pageSize=${pageSize}`);
}

export function createAgent(payload: AgentPayload): Promise<AgentDetail> {
  return request<AgentDetail>("/api/v1/agents", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getAgent(id: string): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/v1/agents/${id}`);
}

export function updateAgent(id: string, payload: AgentPayload): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/v1/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteAgent(id: string): Promise<null> {
  return request<null>(`/api/v1/agents/${id}`, {
    method: "DELETE"
  });
}

export type AgentPublishResult = {
  agentId: string;
  published: boolean;
  publishedAt: string | null;
  shareToken: string | null;
};

export type SharedAgentDetail = {
  id: string;
  name: string;
  description: string;
  modelName: string;
  providerName: string;
};

export function publishAgent(id: string): Promise<AgentPublishResult> {
  return request<AgentPublishResult>(`/api/v1/agents/${id}/publish`, {
    method: "POST"
  });
}

export function unpublishAgent(id: string): Promise<AgentPublishResult> {
  return request<AgentPublishResult>(`/api/v1/agents/${id}/publish`, {
    method: "DELETE"
  });
}

export function getSharedAgent(token: string): Promise<SharedAgentDetail> {
  return request<SharedAgentDetail>(`/api/v1/agents/shared/${token}`);
}

export type AgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedAgentApiKey = AgentApiKeyListItem & {
  apiKey: string;
};

/** 创建响应是唯一能获取完整 Key 的时机，调用方应立即复制到业务后端的安全配置中。 */
export function createAgentApiKey(
  agentId: string,
  payload: { name: string; expiresAt?: string | null }
): Promise<CreatedAgentApiKey> {
  return request<CreatedAgentApiKey>(`/api/v1/agents/${agentId}/api-keys`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/** 列表只包含前缀和生命周期信息，完整服务端 Key 不会再次返回。 */
export function listAgentApiKeys(agentId: string): Promise<AgentApiKeyListItem[]> {
  return request<AgentApiKeyListItem[]>(`/api/v1/agents/${agentId}/api-keys`);
}

export function revokeAgentApiKey(agentId: string, keyId: string): Promise<null> {
  return request<null>(`/api/v1/agents/${agentId}/api-keys/${keyId}`, {
    method: "DELETE"
  });
}

export function rotateAgentApiKey(agentId: string, keyId: string): Promise<CreatedAgentApiKey> {
  return request<CreatedAgentApiKey>(`/api/v1/agents/${agentId}/api-keys/${keyId}/rotate`, {
    method: "POST"
  });
}

export type AgentPublicAccessConfig = {
  agentId: string;
  publicExpiresAt: string | null;
  allowedOrigins: string[];
  passwordRequired: boolean;
};

export type UpdateAgentPublicAccessPayload = {
  publicExpiresAt?: string | null;
  allowedOrigins?: string[];
  password?: string | null;
};

/** 读取公开分享的安全策略，不会返回访问密码的任何可逆信息。 */
export function getAgentPublicAccess(agentId: string): Promise<AgentPublicAccessConfig> {
  return request<AgentPublicAccessConfig>(`/api/v1/agents/${agentId}/public-access`);
}

/** 更新公开链接的到期时间、Widget 来源白名单和可选的访问密码。 */
export function updateAgentPublicAccess(
  agentId: string,
  payload: UpdateAgentPublicAccessPayload
): Promise<AgentPublicAccessConfig> {
  return request<AgentPublicAccessConfig>(`/api/v1/agents/${agentId}/public-access`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/** 返回新 Token；旧链接立即失效，因此 UI 必须提醒管理员更新嵌入产物。 */
export function rotateAgentPublicToken(agentId: string): Promise<AgentPublishResult> {
  return request<AgentPublishResult>(`/api/v1/agents/${agentId}/public-access/rotate-token`, {
    method: "POST"
  });
}

export type AgentToolBindingResult = {
  agentId: string;
  toolIds: string[];
};

export function getAgentTools(id: string): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`);
}

export function updateAgentTools(id: string, toolIds: string[]): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`, {
    method: "PUT",
    body: JSON.stringify({ toolIds })
  });
}

export type AgentKnowledgeBaseBindingResult = {
  agentId: string;
  knowledgeBaseIds: string[];
};

export function getAgentKnowledgeBases(id: string): Promise<AgentKnowledgeBaseBindingResult> {
  return request<AgentKnowledgeBaseBindingResult>(`/api/v1/agents/${id}/knowledge-bases`);
}

export function updateAgentKnowledgeBases(
  id: string,
  knowledgeBaseIds: string[]
): Promise<AgentKnowledgeBaseBindingResult> {
  return request<AgentKnowledgeBaseBindingResult>(`/api/v1/agents/${id}/knowledge-bases`, {
    method: "PUT",
    body: JSON.stringify({ knowledgeBaseIds })
  });
}
