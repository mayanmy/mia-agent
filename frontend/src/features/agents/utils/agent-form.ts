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
  chatSessionMode: "EPHEMERAL",
  thinkingMode: "AUTO",
  visionMode: "AUTO",
  visionModelConfigId: null,
  enabled: true,
  toolIds: [],
  knowledgeBaseIds: [],
  skillIds: []
};

/** 将表单值转换为后端基础配置载荷，绑定关系由独立接口保存。 */
export function toAgentPayload(values: AgentFormValues): AgentPayload {
  return {
    name: values.name.trim(),
    description: values.description?.trim() || "",
    modelConfigId: values.modelConfigId,
    systemPrompt: values.systemPrompt.trim(),
    temperature: values.temperature,
    maxTokens: values.maxTokens ?? null,
    historyTurns: values.historyTurns,
    chatSessionMode: values.chatSessionMode,
    thinkingMode: values.thinkingMode,
    visionMode: values.visionMode,
    visionModelConfigId:
      values.visionMode === "DEDICATED" ? (values.visionModelConfigId ?? null) : null,
    enabled: values.enabled
  };
}

/** 将 Agent 详情映射为表单初始值。 */
export function toAgentFormValues(agent: AgentDetail): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    modelConfigId: agent.modelConfigId,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    historyTurns: agent.historyTurns,
    chatSessionMode: agent.chatSessionMode,
    thinkingMode: agent.thinkingMode,
    visionMode: agent.visionMode,
    visionModelConfigId: agent.visionModelConfigId,
    enabled: agent.enabled,
    toolIds: agent.toolIds,
    knowledgeBaseIds: agent.knowledgeBaseIds,
    skillIds: agent.skillIds
  };
}
