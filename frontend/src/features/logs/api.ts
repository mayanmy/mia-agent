import { request, type PageResult } from "../../shared/api/client";

/** 工具调用从可用、选择到执行完成的日志状态。 */
export type ToolCallLogStatus = "available" | "skipped" | "requested" | "completed" | "failed";

/** 日志列表中的脱敏工具调用快照。 */
export type ToolCallLogListItem = {
  /** 日志记录 ID。 */
  id: string;
  /** 所属调用链 ID。 */
  requestId: string | null;
  /** 所属 Agent ID。 */
  agentId: string | null;
  /** 发起成员 ID；匿名调用为空。 */
  userId: string | null;
  /** 模型生成的工具调用 ID。 */
  toolCallId: string | null;
  /** Mia 工具运行时 ID。 */
  toolId: string | null;
  /** 调用生命周期状态。 */
  status: string;
  /** builtin、http 或 mcp 等来源。 */
  source: string | null;
  /** 跳过或拒绝原因。 */
  reason: string | null;
  /** 已脱敏输入快照。 */
  input: unknown;
  /** 已脱敏并截断的输出快照。 */
  output: unknown;
  /** 稳定错误分类。 */
  errorType: string | null;
  /** 管理员排障信息。 */
  errorMessage: string | null;
  /** 调用耗时毫秒数。 */
  elapsedMs: number | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
};

/** 日志列表分页、归属和时间范围筛选。 */
export type ToolCallLogQuery = {
  page?: number;
  pageSize?: number;
  requestId?: string;
  agentId?: string;
  toolId?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
};

export function listToolCallLogs(
  query: ToolCallLogQuery
): Promise<PageResult<ToolCallLogListItem>> {
  const searchParams = new URLSearchParams();

  // 只发送有值筛选项，避免空字符串被后端误解为精确筛选条件。
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  return request<PageResult<ToolCallLogListItem>>(
    `/api/v1/logs/tool-calls?${searchParams.toString()}`
  );
}
