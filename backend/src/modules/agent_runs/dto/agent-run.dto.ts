import { AgentRunSource, AgentRunStatus, WorkflowRunMode } from "@prisma/client";

/** 创建 Agent Run 主记录的输入；仅包含可跨模块传递的业务字段。 */
export type CreateAgentRunDto = {
  /** 贯穿 API、模型、工具与日志的链路 ID。 */
  requestId: string;
  /** 区分内部 Chat、公开 API 或 Workflow 等运行入口。 */
  source: AgentRunSource;
  /** 本次运行使用的 Agent ID；独立 Workflow 应用运行时为空。 */
  agentId?: string;
  /** 匿名入口没有用户 ID。 */
  userId?: string;
  /** 持久会话 ID；临时对话为空。 */
  sessionId?: string;
  /** 外部调用方维护的会话标识。 */
  externalConversationId?: string;
  /** Workflow 模式下实际执行的 Workflow ID。 */
  workflowId?: string;
  /** 固定的不可变 Workflow 版本 ID。 */
  workflowVersionId?: string;
  /** Workflow 的调试或发布运行模式。 */
  workflowRunMode?: WorkflowRunMode;
  /** 脱敏截断后的输入摘要，不保存完整敏感内容。 */
  inputPreview: string;
};

/** Run 创建后供编排流程继续更新状态的最小上下文。 */
export type AgentRunContext = {
  /** Run 主记录 ID。 */
  runId: string;
  /** 本次运行的链路 ID。 */
  requestId: string;
  /** 创建完成时的初始状态。 */
  status: AgentRunStatus;
};

/** 成功结束 Agent Run 时写入的结果摘要。 */
export type CompleteAgentRunDto = {
  /** 脱敏截断后的输出摘要。 */
  outputPreview: string;
  /** 供应商返回时才记录的输入 token 数。 */
  inputTokens?: number;
  /** 供应商返回时才记录的输出 token 数。 */
  outputTokens?: number;
  /** 按模型价格估算的成本，不作为计费依据。 */
  estimatedCost?: number;
};

/** 失败 Run 的稳定错误分类和排障消息。 */
export type AgentRunErrorDto = {
  /** 供筛选统计使用的稳定错误类型。 */
  type: string;
  /** 面向管理员的错误详情。 */
  message: string;
};
