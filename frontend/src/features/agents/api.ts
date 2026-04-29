import { request, type PageResult } from "../../shared/api/client";
import type { ModelProviderType } from "../model-providers/api";

export type AgentGenerationParams = Record<string, string | number | boolean | null>;

export type AgentListItem = {
  id: string;
  name: string;
  description: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  toolCount: number;
  temperature: number;
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
  generationParams: AgentGenerationParams | null;
  toolIds: string[];
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

export type AgentToolBindingResult = {
  agentId: string;
  toolIds: string[];
};

export function getAgentTools(id: string): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`);
}

export function updateAgentTools(
  id: string,
  toolIds: string[]
): Promise<AgentToolBindingResult> {
  return request<AgentToolBindingResult>(`/api/v1/agents/${id}/tools`, {
    method: "PUT",
    body: JSON.stringify({ toolIds })
  });
}
