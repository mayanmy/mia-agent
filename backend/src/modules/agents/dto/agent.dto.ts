import { AgentChatSessionMode, ModelConfigType, ModelProviderType } from "@prisma/client";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type AgentGenerationParams = JsonObject;

export type AgentCreateDto = {
  name?: string;
  description?: string;
  systemPrompt?: string;
  modelConfigId?: string;
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
  historyTurns?: number;
  chatSessionMode?: AgentChatSessionMode;
  generationParams?: AgentGenerationParams | null;
  enabled?: boolean;
};

export type AgentUpdateDto = Partial<AgentCreateDto>;

export type AgentQueryDto = {
  page?: string;
  pageSize?: string;
  enabled?: string;
};

export type AgentModelConfigSummary = {
  id: string;
  modelName: string;
  modelType: ModelConfigType;
  providerId: string;
  providerName: string;
  providerType: ModelProviderType;
};

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
  publishedAt: Date | null;
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentDetail = AgentListItem & {
  systemPrompt: string;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  chatSessionMode: AgentChatSessionMode;
  generationParams: AgentGenerationParams | null;
  toolIds: string[];
  knowledgeBaseIds: string[];
  modelConfig: AgentModelConfigSummary;
};

export type AgentToolBindingDto = {
  toolIds?: string[];
};

export type AgentToolBindingResult = {
  agentId: string;
  toolIds: string[];
};

export type AgentKnowledgeBaseBindingDto = {
  knowledgeBaseIds?: string[];
};

export type AgentKnowledgeBaseBindingResult = {
  agentId: string;
  knowledgeBaseIds: string[];
};

export type AgentPublishResult = {
  agentId: string;
  published: boolean;
  publishedAt: Date | null;
  shareToken: string | null;
};

export type SharedAgentDetail = {
  id: string;
  name: string;
  description: string;
  modelName: string;
  providerName: string;
  passwordRequired?: boolean;
};

/** 仅供 external_access 模块使用的公开运行时配置，不可返回给通用工作台接口。 */
export type AgentPublicAccessRuntime = SharedAgentDetail & {
  publicExpiresAt: Date | null;
  publicAllowedOrigins: string[];
  publicPasswordHash: string | null;
};

export type AgentPublicAccessConfig = {
  agentId: string;
  publicExpiresAt: Date | null;
  publicAllowedOrigins: string[];
  passwordRequired: boolean;
};

export type AgentRuntimeConfig = {
  agentId: string;
  name: string;
  systemPrompt: string;
  modelConfigId: string;
  modelName: string;
  providerId: string;
  providerType: ModelProviderType;
  baseUrl: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  chatSessionMode: AgentChatSessionMode;
  generationParams: AgentGenerationParams | null;
  knowledgeBaseIds: string[];
  toolIds: string[];
};
