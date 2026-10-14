import { request, type PageResult } from "../../shared/api/client";
import type { ModelProviderType } from "../model-providers/api";

/** 前端表单允许提交的扁平模型扩展参数。 */
export type AgentGenerationParams = Record<string, string | number | boolean | null>;
/** Agent 对话历史的保存模式。 */
export type AgentChatSessionMode = "EPHEMERAL" | "PERSISTENT";
export type AgentThinkingMode = "AUTO" | "ENABLED" | "DISABLED";
export type AgentVisionMode = "AUTO" | "PRIMARY_ONLY" | "DEDICATED" | "DISABLED";

/** Agent 列表接口返回的摘要。 */
export type AgentListItem = {
  /** Agent ID。 */
  id: string;
  /** 创建者摘要。 */
  creator: { id: string; displayName: string };
  /** 当前成员可用的管理操作，由后端计算。 */
  permissions: { canEdit: boolean; canDelete: boolean; canPublish: boolean };
  /** Agent 展示名称。 */
  name: string;
  /** Agent 用途说明。 */
  description: string;
  /** 当前模型配置 ID。 */
  modelConfigId: string;
  /** 当前模型名称。 */
  modelName: string;
  /** 当前模型供应商名称。 */
  providerName: string;
  /** 已绑定工具数量。 */
  toolCount: number;
  /** 已绑定知识库数量。 */
  knowledgeBaseCount: number;
  /** 已绑定 Skill 数量。 */
  skillCount: number;
  /** 模型采样温度。 */
  temperature: number;
  /** 模型上下文保留的历史轮数。 */
  historyTurns: number;
  /** 临时或持久会话模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 是否允许团队成员使用。 */
  enabled: boolean;
  /** 是否已开放分享链接。 */
  published: boolean;
  /** 最近发布时间；未发布时为 null。 */
  publishedAt: string | null;
  /** 当前分享令牌；未发布时为 null。 */
  shareToken: string | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式更新时间。 */
  updatedAt: string;
};

/** Agent 绑定模型的展示摘要，不包含密钥。 */
export type AgentModelConfigSummary = {
  /** 模型配置 ID。 */
  id: string;
  /** 供应商侧模型名称。 */
  modelName: string;
  /** 模型用途类型。 */
  modelType: "CHAT" | "EMBEDDING";
  /** 供应商 ID。 */
  providerId: string;
  /** 供应商展示名称。 */
  providerName: string;
  /** 供应商协议类型。 */
  providerType: ModelProviderType;
};

/** Agent 编辑页面使用的完整详情。 */
export type AgentDetail = AgentListItem & {
  /** 系统提示词全文。 */
  systemPrompt: string;
  /** 模型采样温度。 */
  temperature: number;
  /** 生成 token 上限；null 表示使用模型默认值。 */
  maxTokens: number | null;
  /** 模型调用超时秒数。 */
  timeoutSeconds: number;
  /** 携带到模型上下文的历史轮数。 */
  historyTurns: number;
  /** 对话历史保存模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 模型扩展生成参数。 */
  generationParams: AgentGenerationParams | null;
  thinkingMode: AgentThinkingMode;
  visionMode: AgentVisionMode;
  visionModelConfigId: string | null;
  /** 已绑定工具 ID。 */
  toolIds: string[];
  /** 已绑定知识库 ID。 */
  knowledgeBaseIds: string[];
  /** 按 Prompt 注入顺序排列的 Skill ID。 */
  skillIds: string[];
  /** 当前模型配置摘要。 */
  modelConfig: AgentModelConfigSummary;
};

/** 创建或更新 Agent 基础配置的请求载荷。 */
export type AgentPayload = {
  /** Agent 名称。 */
  name: string;
  /** Agent 用途说明。 */
  description: string;
  /** 系统提示词。 */
  systemPrompt: string;
  /** Chat 模型配置 ID。 */
  modelConfigId: string;
  /** 模型采样温度。 */
  temperature: number;
  /** 生成 token 上限。 */
  maxTokens: number | null;
  /** 历史上下文轮数。 */
  historyTurns: number;
  /** 对话历史保存模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 是否启用。 */
  enabled: boolean;
  thinkingMode: AgentThinkingMode;
  visionMode: AgentVisionMode;
  visionModelConfigId: string | null;
};

/** 分页读取 Agent 列表。 */
export function listAgents(page = 1, pageSize = 20): Promise<PageResult<AgentListItem>> {
  return request<PageResult<AgentListItem>>(`/api/v1/agents?page=${page}&pageSize=${pageSize}`);
}

/** 创建 Agent 基础配置。 */
export function createAgent(payload: AgentPayload): Promise<AgentDetail> {
  return request<AgentDetail>("/api/v1/agents", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/** 获取 Agent 编辑详情。 */
export function getAgent(id: string): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/v1/agents/${id}`);
}

/** 更新 Agent 基础配置。 */
export function updateAgent(id: string, payload: AgentPayload): Promise<AgentDetail> {
  return request<AgentDetail>(`/api/v1/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/** 软删除 Agent。 */
export function deleteAgent(id: string): Promise<null> {
  return request<null>(`/api/v1/agents/${id}`, {
    method: "DELETE"
  });
}

/** 发布状态变更后的公开链接信息。 */
export type AgentPublishResult = {
  /** Agent ID。 */
  agentId: string;
  /** 当前发布状态。 */
  published: boolean;
  /** 最近发布时间。 */
  publishedAt: string | null;
  /** 当前分享令牌。 */
  shareToken: string | null;
};

/** 匿名分享页面可以展示的 Agent 信息。 */
export type SharedAgentDetail = {
  /** Agent ID。 */
  id: string;
  /** Agent 名称。 */
  name: string;
  /** Agent 用途说明。 */
  description: string;
  /** 模型名称。 */
  modelName: string;
  /** 模型供应商名称。 */
  providerName: string;
};

/** 发布 Agent 并取得公开分享信息。 */
export function publishAgent(id: string): Promise<AgentPublishResult> {
  return request<AgentPublishResult>(`/api/v1/agents/${id}/publish`, {
    method: "POST"
  });
}

/** 取消发布并使旧分享链接失效。 */
export function unpublishAgent(id: string): Promise<AgentPublishResult> {
  return request<AgentPublishResult>(`/api/v1/agents/${id}/publish`, {
    method: "DELETE"
  });
}

/** 通过分享令牌读取匿名页面所需信息。 */
export function getSharedAgent(token: string): Promise<SharedAgentDetail> {
  return request<SharedAgentDetail>(`/api/v1/agents/shared/${token}`);
}

/** Agent API Key 列表中的安全摘要，永不包含完整密钥。 */
export type AgentApiKeyListItem = {
  /** Key 记录 ID。 */
  id: string;
  /** 管理员设置的 Key 名称。 */
  name: string;
  /** 用于辨认密钥的非敏感前缀。 */
  keyPrefix: string;
  /** 最近使用时间。 */
  lastUsedAt: string | null;
  /** 到期时间；null 表示不过期。 */
  expiresAt: string | null;
  /** 吊销时间；null 表示尚未吊销。 */
  revokedAt: string | null;
  /** 创建时间。 */
  createdAt: string;
};

/** API Key 创建或轮换结果，完整密钥只在本次响应出现。 */
export type CreatedAgentApiKey = AgentApiKeyListItem & {
  /** 应立即复制并安全保存的完整 API Key。 */
  apiKey: string;
};

/** 创建 Agent API Key 的请求载荷。 */
export type CreateAgentApiKeyPayload = {
  /** 便于管理员识别用途的 Key 名称。 */
  name: string;
  /** 可选 ISO 到期时间；null 表示不过期。 */
  expiresAt?: string | null;
};

/** 创建响应是唯一能获取完整 Key 的时机，调用方应立即复制到业务后端的安全配置中。 */
export function createAgentApiKey(
  agentId: string,
  payload: CreateAgentApiKeyPayload
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

/** 吊销指定 API Key；完整密钥无需也不能由前端再次提交。 */
export function revokeAgentApiKey(agentId: string, keyId: string): Promise<null> {
  return request<null>(`/api/v1/agents/${agentId}/api-keys/${keyId}`, {
    method: "DELETE"
  });
}

/** 轮换 API Key，旧 Key 失效且新明文只返回一次。 */
export function rotateAgentApiKey(agentId: string, keyId: string): Promise<CreatedAgentApiKey> {
  return request<CreatedAgentApiKey>(`/api/v1/agents/${agentId}/api-keys/${keyId}/rotate`, {
    method: "POST"
  });
}

/** Agent 当前公开访问安全策略。 */
export type AgentPublicAccessConfig = {
  /** Agent ID。 */
  agentId: string;
  /** 分享链接到期时间；null 表示不过期。 */
  publicExpiresAt: string | null;
  /** Widget 允许嵌入的来源白名单。 */
  allowedOrigins: string[];
  /** 当前是否设置了访问密码。 */
  passwordRequired: boolean;
};

/** 更新 Agent 公开访问安全策略的载荷。 */
export type UpdateAgentPublicAccessPayload = {
  /** 新到期时间；null 表示清除期限。 */
  publicExpiresAt?: string | null;
  /** 新的 Widget 来源白名单。 */
  allowedOrigins?: string[];
  /** 新访问密码；null 表示清除现有密码。 */
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

/** Agent 工具绑定接口返回值。 */
export type AgentToolBindingResult = {
  /** Agent ID。 */
  agentId: string;
  /** 实际保存的工具 ID。 */
  toolIds: string[];
};

/** 读取 Agent 工具绑定。 */
export function getAgentTools(id: string): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`);
}

/** 用完整 ID 集合替换 Agent 工具绑定。 */
export function updateAgentTools(id: string, toolIds: string[]): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`, {
    method: "PUT",
    body: JSON.stringify({ toolIds })
  });
}

export type AgentSkillBindingResult = {
  agentId: string;
  skills: Array<{ skillId: string; position: number; enabled: boolean }>;
};

export function getAgentSkills(id: string): Promise<AgentSkillBindingResult> {
  return request<AgentSkillBindingResult>(`/api/v1/agents/${id}/skills`);
}

export function updateAgentSkills(
  id: string,
  skillIds: string[]
): Promise<AgentSkillBindingResult> {
  return request<AgentSkillBindingResult>(`/api/v1/agents/${id}/skills`, {
    method: "PUT",
    body: JSON.stringify({ skills: skillIds.map((skillId) => ({ skillId })) })
  });
}

/** Agent 知识库绑定接口返回值。 */
export type AgentKnowledgeBaseBindingResult = {
  /** Agent ID。 */
  agentId: string;
  /** 实际保存的知识库 ID。 */
  knowledgeBaseIds: string[];
};

/** 读取 Agent 知识库绑定。 */
export function getAgentKnowledgeBases(id: string): Promise<AgentKnowledgeBaseBindingResult> {
  return request<AgentKnowledgeBaseBindingResult>(`/api/v1/agents/${id}/knowledge-bases`);
}

/** 用完整 ID 集合替换 Agent 知识库绑定。 */
export function updateAgentKnowledgeBases(
  id: string,
  knowledgeBaseIds: string[]
): Promise<AgentKnowledgeBaseBindingResult> {
  return request<AgentKnowledgeBaseBindingResult>(`/api/v1/agents/${id}/knowledge-bases`, {
    method: "PUT",
    body: JSON.stringify({ knowledgeBaseIds })
  });
}
