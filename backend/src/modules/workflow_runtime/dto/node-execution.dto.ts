import { CompiledWorkflowNode } from "../../workflows/dto/compiled-plan.dto";
import { WorkflowContext } from "../workflow-context";

export type NodeExecutionStatus = "completed" | "failed" | "skipped";

export type NodeExecutionResult = {
  status: NodeExecutionStatus;
  output: Record<string, unknown>;
  nextHandle?: string;
};

export type NodeExecutionEvent =
  { type: "token"; data: { content: string } } | { type: "result"; data: NodeExecutionResult };

export type WorkflowNodeExecutionRequest = {
  node: CompiledWorkflowNode;
  context: WorkflowContext;
  signal?: AbortSignal;
};

export interface WorkflowNodeExecutor {
  readonly type: string;
  execute(
    request: WorkflowNodeExecutionRequest
  ): Promise<NodeExecutionResult> | AsyncIterable<NodeExecutionEvent>;
}
