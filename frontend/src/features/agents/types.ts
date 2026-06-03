import type { AgentListItem } from "./api";

export type AgentFormValues = {
  name: string;
  description?: string;
  modelConfigId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens?: number | null;
  historyTurns: number;
  enabled: boolean;
  toolIds: string[];
};

export type AgentTableItem = AgentListItem & {
  toolCount: number;
};

export type EmbedScenario = "single" | "multi" | "spa" | "inline";
