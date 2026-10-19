import type { ToolCallLogStatus } from "../../tools/dto/tool.dto";
import type { PageQuery } from "../../../core/pagination";

export type RagTraceStatus = "completed" | "failed" | "canceled";

/** Chat 模块提交给日志模块的完整、安全 RAG 快照。 */
export type CreateRagTraceDto = {
  requestId: string;
  sessionId?: string;
  messageId?: string;
  userId?: string;
  agentId: string;
  agentConfigSnapshot: Record<string, unknown>;
  query: string;
  rewrittenQuery?: string;
  retrievalConfigSnapshot: Record<string, unknown>;
  candidateChunks: Array<Record<string, unknown>>;
  selectedChunks: Array<Record<string, unknown>>;
  promptVersion: string;
  modelConfigSnapshot: Record<string, unknown>;
  answer: string;
  citations: Array<Record<string, unknown>>;
  retrievalElapsedMs?: number;
  firstTokenElapsedMs?: number;
  totalElapsedMs?: number;
  tokenUsage?: Record<string, unknown>;
  status: RagTraceStatus;
  error?: Record<string, unknown>;
};

export type RagTraceQueryDto = PageQuery & {
  requestId?: string;
  messageId?: string;
  agentId?: string;
  status?: RagTraceStatus;
  createdFrom?: string;
  createdTo?: string;
};

export type LogEventDto = {
  requestId?: string;
  eventType: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  messageId?: string;
  payload?: Record<string, unknown>;
};

/** 工具调用日志列表的分页、归属和时间范围筛选。 */
export type ToolCallLogQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
  /** 精确匹配一次调用链。 */
  requestId?: string;
  /** 限定 Agent ID。 */
  agentId?: string;
  /** 限定工具运行时 ID。 */
  toolId?: string;
  /** 工具调用生命周期状态。 */
  status?: ToolCallLogStatus;
  /** 创建时间下界，由 Service 统一解析。 */
  createdFrom?: string;
  /** 创建时间上界，由 Service 统一解析。 */
  createdTo?: string;
};

/** 工具日志列表返回的脱敏调用快照。 */
export type ToolCallLogListItem = {
  /** 日志记录 ID。 */
  id: string;
  /** 所属调用链 ID；早期或独立调用可能为空。 */
  requestId: string | null;
  /** 所属 Agent ID。 */
  agentId: string | null;
  /** 发起成员 ID；匿名调用为空。 */
  userId: string | null;
  /** 模型供应商生成的工具调用 ID。 */
  toolCallId: string | null;
  /** Mia 工具运行时 ID。 */
  toolId: string | null;
  /** 调用生命周期状态。 */
  status: string;
  /** builtin、http 或 mcp 等工具来源。 */
  source: string | null;
  /** 跳过、拒绝等非错误状态原因。 */
  reason: string | null;
  /** 已脱敏的输入快照。 */
  input: unknown;
  /** 已脱敏且按上限截断的输出快照。 */
  output: unknown;
  /** 稳定错误分类。 */
  errorType: string | null;
  /** 面向管理员的错误详情。 */
  errorMessage: string | null;
  /** 工具调用耗时毫秒数。 */
  elapsedMs: number | null;
  /** 日志创建时间。 */
  createdAt: Date;
};
