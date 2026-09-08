import { RuntimeError } from "./runtime-error.dto";

/** Runtime 汇总的模型 token 与估算成本。 */
export type RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
};

/** run_started 事件携带的模型、会话和执行模式快照。 */
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

/** Runtime 成功结束时返回的完整内容与运行快照。 */
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

/** Agent Runtime 对 Chat/SSE 暴露的固定事件联合。 */
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
