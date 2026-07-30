import type { AgentChatSessionMode, AgentListItem } from "./api";

/** Agent 新建/编辑表单的完整值结构。 */
export type AgentFormValues = {
  /** Agent 名称。 */
  name: string;
  /** Agent 用途说明。 */
  description?: string;
  /** 绑定的 Chat 模型配置 ID。 */
  modelConfigId: string;
  /** 系统提示词。 */
  systemPrompt: string;
  /** 模型采样温度。 */
  temperature: number;
  /** 生成 token 上限；null 表示使用模型默认值。 */
  maxTokens?: number | null;
  /** 模型上下文保留的历史轮数。 */
  historyTurns: number;
  /** 临时或持久会话模式。 */
  chatSessionMode: AgentChatSessionMode;
  /** 是否允许成员使用。 */
  enabled: boolean;
  /** 表单中选择的工具 ID。 */
  toolIds: string[];
  /** 表单中选择的知识库 ID。 */
  knowledgeBaseIds: string[];
};

/** Agent 表格行模型，保留显式工具数量供列渲染使用。 */
export type AgentTableItem = AgentListItem & {
  /** 已绑定工具数量。 */
  toolCount: number;
};

/** 嵌入代码面板支持的部署场景。 */
export type EmbedScenario = "single" | "multi" | "spa" | "inline";
