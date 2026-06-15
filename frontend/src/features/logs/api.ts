import { request, type PageResult } from "../../shared/api/client";

export type ToolCallLogStatus = "available" | "skipped" | "requested" | "completed" | "failed";

export type ToolCallLogListItem = {
  id: string;
  requestId: string | null;
  agentId: string | null;
  userId: string | null;
  toolCallId: string | null;
  toolId: string | null;
  status: string;
  source: string | null;
  reason: string | null;
  input: unknown;
  output: unknown;
  errorType: string | null;
  errorMessage: string | null;
  elapsedMs: number | null;
  createdAt: string;
};

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

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  return request<PageResult<ToolCallLogListItem>>(
    `/api/v1/logs/tool-calls?${searchParams.toString()}`
  );
}
