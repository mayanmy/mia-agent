import { RuntimeError } from "./runtime-error.dto";

export type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
};

export type RuntimeRunStartedData = {
  runId?: string;
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  sessionId: string | null;
  executionMode?: "AGENT_LOOP" | "WORKFLOW";
  workflowId?: string;
  workflowVersionId?: string;
};

export type RuntimeCompletion = {
  runId?: string;
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  sessionId: string | null;
  content: string;
  executionMode?: "AGENT_LOOP" | "WORKFLOW";
  workflowId?: string;
  workflowVersionId?: string;
  usage?: RuntimeUsage;
  /** Chat 持久会话成功落库后的 Assistant 消息 ID。 */
  messageId?: string;
};

export type AgentRuntimeEvent =
  | { type: "run_started"; data: RuntimeRunStartedData }
  | { type: "tool_search_started"; data: { boundToolCount: number } }
  | {
      type: "tool_search_completed";
      data: {
        boundToolCount: number;
        catalogMatchCount: number;
        selectedToolIds: string[];
      };
    }
  | { type: "retrieval_started"; data: Record<string, unknown> }
  | { type: "retrieval_completed"; data: Record<string, unknown> }
  | { type: "token"; data: { content: string } }
  | { type: "tool_started"; data: Record<string, unknown> }
  | {
      type: "tool_approval_required";
      data: {
        approvalId: string;
        toolCallId: string;
        toolId: string;
        expiresAt: string;
      };
    }
  | {
      type: "tool_approval_resolved";
      data: { approvalId: string; toolCallId: string; approved: boolean; status: string };
    }
  | { type: "tool_completed"; data: Record<string, unknown> }
  | { type: "run_completed"; data: RuntimeCompletion }
  | { type: "run_failed"; data: { runId?: string; error: RuntimeError } }
  | { type: "run_canceled"; data: { runId?: string } };
