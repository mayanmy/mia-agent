import type { AgentDetail, AgentPayload } from "../api";
import type { AgentFormValues } from "../types";

export const defaultAgentFormValues: AgentFormValues = {
  name: "",
  description: "",
  modelConfigId: "",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: null,
  historyTurns: 6,
  enabled: true,
  toolIds: []
};

export function toAgentPayload(values: AgentFormValues): AgentPayload {
  return {
    name: values.name.trim(),
    description: values.description?.trim() || "",
    modelConfigId: values.modelConfigId,
    systemPrompt: values.systemPrompt.trim(),
    temperature: values.temperature,
    maxTokens: values.maxTokens ?? null,
    historyTurns: values.historyTurns,
    enabled: values.enabled
  };
}

export function toAgentFormValues(agent: AgentDetail): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    modelConfigId: agent.modelConfigId,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    historyTurns: agent.historyTurns,
    enabled: agent.enabled,
    toolIds: agent.toolIds
  };
}
