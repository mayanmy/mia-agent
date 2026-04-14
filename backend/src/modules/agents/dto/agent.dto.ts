import { ModelConfigType, ModelProviderType } from '@prisma/client';

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
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentDetail = AgentListItem & {
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  generationParams: AgentGenerationParams | null;
  modelConfig: AgentModelConfigSummary;
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
  generationParams: AgentGenerationParams | null;
  knowledgeBaseIds: string[];
  toolIds: string[];
};
