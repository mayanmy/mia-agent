import {
  AgentRunSource,
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepType,
  WorkflowRunMode
} from "@prisma/client";

/** Run Trace 列表的分页、归属与时间范围筛选参数。 */
export type AgentRunQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
  /** 精确匹配一次调用链。 */
  requestId?: string;
  /** 限定 Agent ID。 */
  agentId?: string;
  /** 限定发起成员 ID。 */
  userId?: string;
  /** 限定 Workflow ID。 */
  workflowId?: string;
  /** 限定不可变 Workflow 版本 ID。 */
  workflowVersionId?: string;
  /** Run 最终或当前状态。 */
  status?: AgentRunStatus;
  /** 内部 Chat、公开调用等运行来源。 */
  source?: AgentRunSource;
  /** 创建时间下界，Controller 接收后由 Service 统一解析。 */
  createdFrom?: string;
  /** 创建时间上界，Controller 接收后由 Service 统一解析。 */
  createdTo?: string;
};

/** Run Trace 列表展示与统计所需的运行摘要。 */
export type AgentRunListItem = {
  /** Run 主记录 ID。 */
  id: string;
  /** 贯穿模型、检索、工具和日志的链路 ID。 */
  requestId: string;
  /** 运行入口来源。 */
  source: AgentRunSource;
  /** 当前或最终运行状态。 */
  status: AgentRunStatus;
  /** 执行使用的 Agent ID。 */
  agentId: string;
  /** 匿名运行时为空。 */
  userId: string | null;
  /** 临时会话或外部调用时为空。 */
  sessionId: string | null;
  /** 实际使用的模型配置；工作流无模型节点时可为空。 */
  modelConfigId: string | null;
  /** 非 Workflow 模式时为空。 */
  workflowId: string | null;
  /** 实际执行的不可变版本 ID。 */
  workflowVersionId: string | null;
  /** Workflow 调试或发布运行模式。 */
  workflowRunMode: WorkflowRunMode | null;
  /** 脱敏截断后的输入摘要。 */
  inputPreview: string;
  /** 成功产生内容时的脱敏输出摘要。 */
  outputPreview: string | null;
  /** 供应商提供时记录的输入 token 数。 */
  inputTokens: number | null;
  /** 供应商提供时记录的输出 token 数。 */
  outputTokens: number | null;
  /** 收到首个模型 token 的时间。 */
  firstTokenAt: Date | null;
  /** Runtime 真正开始执行的时间。 */
  startedAt: Date | null;
  /** 成功、失败或取消落定的时间。 */
  finishedAt: Date | null;
  /** 供筛选统计使用的稳定错误分类。 */
  errorType: string | null;
  /** 面向管理员的错误详情。 */
  errorMessage: string | null;
  /** Run 主记录创建时间。 */
  createdAt: Date;
  /** 已记录的步骤数量。 */
  stepCount: number;
};

/** Run 详情中的单个步骤快照。 */
export type AgentRunStepDetail = {
  /** 步骤记录 ID。 */
  id: string;
  /** Run 内严格递增的执行顺序。 */
  sequence: number;
  /** 检索、模型、工具或 Workflow 节点等步骤类型。 */
  type: AgentRunStepType;
  /** 面向排障页面的步骤名称。 */
  name: string;
  /** Workflow 节点 ID；Agent Loop 步骤通常为空。 */
  nodeId: string | null;
  /** 当前步骤尝试次数，从 1 开始。 */
  attempt: number;
  /** 执行状态。 */
  status: AgentRunStepStatus;
  /** 可序列化的输入快照。 */
  input: unknown;
  /** 可序列化的输出快照。 */
  output: unknown;
  /** 步骤耗时毫秒数。 */
  elapsedMs: number | null;
  /** 稳定错误分类。 */
  errorType: string | null;
  /** 管理员排障错误详情。 */
  errorMessage: string | null;
  /** 步骤开始时间。 */
  startedAt: Date;
  /** 尚未结束时为空。 */
  finishedAt: Date | null;
};

/** Run 列表摘要加外部关联、成本与完整步骤。 */
export type AgentRunDetail = AgentRunListItem & {
  /** 外部调用方提供的会话标识。 */
  externalConversationId: string | null;
  /** 十进制定点字符串，避免 JSON 浮点误差。 */
  estimatedCost: string | null;
  /** Run 最近更新时间。 */
  updatedAt: Date;
  /** 按 sequence 正序排列的步骤。 */
  steps: AgentRunStepDetail[];
};

/** Run Trace 定期清理任务的边界和删除统计。 */
export type CleanupAgentRunsResult = {
  /** 已完成 Run 使用的保留截止时间。 */
  completedCutoff: Date;
  /** 失败 Run 使用的保留截止时间。 */
  failedCutoff: Date;
  /** 删除的 Run 数量。 */
  deletedRuns: number;
  /** 随 Run 一并清理的工具调用日志数量。 */
  deletedToolCallLogs: number;
};
