import { request, type PageResult } from "../../shared/api/client";

export type AgentRunStatus =
  "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT";
export type AgentRunSource = "INTERNAL_CHAT" | "PUBLIC_WIDGET" | "SERVICE_API" | "ASYNC_TASK";

export type AgentRunListItem = {
  id: string;
  requestId: string;
  source: AgentRunSource;
  status: AgentRunStatus;
  agentId: string;
  userId: string | null;
  sessionId: string | null;
  modelConfigId: string | null;
  workflowId: string | null;
  workflowVersionId: string | null;
  workflowRunMode: "DRAFT_TEST" | "PUBLISHED" | null;
  inputPreview: string;
  outputPreview: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  firstTokenAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: string;
  stepCount: number;
};

export type AgentRunStep = {
  id: string;
  sequence: number;
  type: string;
  name: string;
  nodeId: string | null;
  attempt: number;
  status: string;
  input: unknown;
  output: unknown;
  elapsedMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AgentRunDetail = AgentRunListItem & {
  externalConversationId: string | null;
  estimatedCost: string | null;
  updatedAt: string;
  steps: AgentRunStep[];
};

export type AgentRunQuery = Partial<{
  page: number;
  pageSize: number;
  requestId: string;
  agentId: string;
  userId: string;
  workflowId: string;
  workflowVersionId: string;
  status: AgentRunStatus;
  source: AgentRunSource;
  createdFrom: string;
  createdTo: string;
}>;

/** 查询管理员 Run 列表，空筛选不会进入 URL。 */
export function listAgentRuns(query: AgentRunQuery): Promise<PageResult<AgentRunListItem>> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return request(`/api/v1/agent-runs?${params.toString()}`);
}

/** 按 Run ID 加载完整 Timeline。 */
export function getAgentRunDetail(runId: string): Promise<AgentRunDetail> {
  return request(`/api/v1/agent-runs/${encodeURIComponent(runId)}`);
}
