import type { SkillDetail } from "../../skills/dto/skill.dto";

/** MCP Prompt 声明的单个模板参数。 */
export type McpPromptArgument = { name: string; description?: string; required: boolean };
/** MCP Server 暴露的 Prompt 目录项。 */
export type McpPromptItem = {
  /** 调用 MCP prompts/get 使用的稳定名称。 */
  name: string;
  /** Server 提供的可选展示标题。 */
  title?: string;
  /** Prompt 用途说明。 */
  description?: string;
  /** Prompt 所需模板参数。 */
  arguments: McpPromptArgument[];
};
/** MCP Prompt 列表响应。 */
export type McpPromptCatalog = { prompts: McpPromptItem[] };
/** 获取或预览单个 MCP Prompt 的输入。 */
export type McpPromptGetDto = { name?: string; arguments?: Record<string, unknown> };
/** 将 MCP 消息内容合并为文本后的安全预览。 */
export type McpPromptPreview = {
  /** Prompt 稳定名称。 */
  name: string;
  /** Prompt 用途说明。 */
  description?: string;
  /** 供管理员确认的合并文本。 */
  text: string;
  /** MCP 原始消息数量。 */
  messageCount: number;
};
/** 导入 Prompt 为 Mia Skill 时的输入。 */
export type McpPromptImportDto = McpPromptGetDto & { skillName?: string };
/** Prompt 导入完成后的来源与 Skill 详情。 */
export type McpPromptImportResult = { serverId: string; promptName: string; skill: SkillDetail };
