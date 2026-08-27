import type { SkillDetail } from "../../skills/dto/skill.dto";

export type McpPromptArgument = { name: string; description?: string; required: boolean };
export type McpPromptItem = {
  name: string;
  title?: string;
  description?: string;
  arguments: McpPromptArgument[];
};
export type McpPromptCatalog = { prompts: McpPromptItem[] };
export type McpPromptGetDto = { name?: string; arguments?: Record<string, unknown> };
export type McpPromptPreview = {
  name: string;
  description?: string;
  text: string;
  messageCount: number;
};
export type McpPromptImportDto = McpPromptGetDto & { skillName?: string };
export type McpPromptImportResult = { serverId: string; promptName: string; skill: SkillDetail };
