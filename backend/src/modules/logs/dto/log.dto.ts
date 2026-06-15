import type { ToolCallLogStatus } from "../../tools/dto/tool.dto";

export type ToolCallLogQueryDto = {
  page?: string;
  pageSize?: string;
  requestId?: string;
  agentId?: string;
  toolId?: string;
  status?: ToolCallLogStatus;
  createdFrom?: string;
  createdTo?: string;
};

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
  createdAt: Date;
};
