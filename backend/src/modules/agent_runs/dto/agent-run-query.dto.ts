import {
  AgentRunSource,
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepType,
  WorkflowRunMode
} from "@prisma/client";

export type AgentRunQueryDto = {
  page?: string;
  pageSize?: string;
  requestId?: string;
  agentId?: string;
  userId?: string;
  status?: AgentRunStatus;
  source?: AgentRunSource;
  createdFrom?: string;
  createdTo?: string;
};

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
  workflowRunMode: WorkflowRunMode | null;
  inputPreview: string;
  outputPreview: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  firstTokenAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: Date;
  stepCount: number;
};

export type AgentRunStepDetail = {
  id: string;
  sequence: number;
  type: AgentRunStepType;
  name: string;
  nodeId: string | null;
  attempt: number;
  status: AgentRunStepStatus;
  input: unknown;
  output: unknown;
  elapsedMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type AgentRunDetail = AgentRunListItem & {
  externalConversationId: string | null;
  estimatedCost: string | null;
  updatedAt: Date;
  steps: AgentRunStepDetail[];
};

export type CleanupAgentRunsResult = {
  completedCutoff: Date;
  failedCutoff: Date;
  deletedRuns: number;
  deletedToolCallLogs: number;
};
