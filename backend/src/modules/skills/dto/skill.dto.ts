import type { PageQuery } from "../../../core/pagination";

/** Skill 列表分页、关键词与启用状态筛选。 */
export type SkillQueryDto = PageQuery & { keyword?: string; enabled?: string | boolean };

/** 创建可复用 Prompt Skill 的输入。 */
export type SkillCreateDto = {
  /** Skill 展示名称。 */
  name?: string;
  /** 帮助成员理解用途的简述。 */
  description?: string;
  /** 注入 Agent 上下文的核心执行说明。 */
  instructions?: string;
  /** 模型判断是否采用该 Skill 的条件。 */
  usageConditions?: string;
  /** 对输入材料的格式和前置要求。 */
  inputGuidance?: string;
  /** 对输出结构和风格的约束。 */
  outputGuidance?: string;
  /** 明确禁止事项和能力边界。 */
  limitations?: string;
  /** 是否允许绑定和使用。 */
  enabled?: boolean;
};

/** 使用乐观锁更新 Skill；expectedRevision 防止覆盖并发编辑。 */
export type SkillUpdateDto = SkillCreateDto & { expectedRevision?: number };
/** 单独切换 Skill 状态时使用的乐观锁输入。 */
export type SkillStatusDto = { enabled?: boolean; expectedRevision?: number };

/** Skill 管理与 Agent 绑定共同使用的完整详情。 */
export type SkillDetail = {
  /** Skill ID。 */
  id: string;
  /** Skill 展示名称。 */
  name: string;
  /** Skill 用途说明。 */
  description: string;
  /** 核心执行说明。 */
  instructions: string;
  /** 使用条件。 */
  usageConditions: string;
  /** 输入指导。 */
  inputGuidance: string;
  /** 输出指导。 */
  outputGuidance: string;
  /** 能力限制。 */
  limitations: string;
  /** 当前是否启用。 */
  enabled: boolean;
  /** 乐观锁修订号。 */
  revision: number;
  /** manual 或 mcp_prompt 等来源类型。 */
  sourceType: string;
  /** 可追溯来源，不包含 MCP 凭据。 */
  sourceRef?: Record<string, unknown>;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式最近更新时间。 */
  updatedAt: string;
};

/** Agent 编辑器使用的轻量 Skill 选项。 */
export type SkillOption = Pick<SkillDetail, "id" | "name" | "description" | "revision">;

/** Agent Runtime 注入 Prompt 所需的稳定 Skill 快照。 */
export type SkillRuntimeConfig = {
  id: string;
  name: string;
  revision: number;
  instructions: string;
  usageConditions: string;
  inputGuidance: string;
  outputGuidance: string;
  limitations: string;
};

export type RuntimeSkillsResult = {
  active: SkillRuntimeConfig[];
  unavailableSkillIds: string[];
};

/** 外部来源导入后交给 Skill Service 校验保存的草稿。 */
export type ImportedSkillDraftDto = {
  /** 建议的 Skill 名称。 */
  name: string;
  /** 可选用途说明。 */
  description?: string;
  /** 已转换为纯文本的执行说明。 */
  instructions: string;
  /** 导入来源类型。 */
  sourceType: string;
  /** 用于追溯和去重的来源引用。 */
  sourceRef: Record<string, unknown>;
};
