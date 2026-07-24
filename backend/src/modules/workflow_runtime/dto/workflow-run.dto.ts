import { WorkflowRunMode } from "@prisma/client";

export type WorkflowRunRequest = {
  requestId: string;
  runId?: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  workflowId: string;
  workflowVersionId: string;
  mode: WorkflowRunMode;
  inputs: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type WorkflowRuntimeErrorData = {
  type: string;
  message: string;
  nodeId?: string;
  retryable: boolean;
};

export type WorkflowRuntimeEvent =
  | { type: "workflow_started"; data: Record<string, unknown> }
  | { type: "node_started"; data: Record<string, unknown> }
  | { type: "node_completed"; data: Record<string, unknown> }
  | { type: "node_failed"; data: Record<string, unknown> }
  | { type: "token"; data: { content: string } }
  | { type: "workflow_completed"; data: Record<string, unknown> }
  | { type: "workflow_failed"; data: { error: WorkflowRuntimeErrorData } }
  | { type: "workflow_canceled"; data: Record<string, unknown> };
