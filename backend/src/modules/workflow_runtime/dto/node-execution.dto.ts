import { CompiledWorkflowNode } from "../../workflows/dto/compiled-plan.dto";
import { WorkflowContext } from "../workflow-context";

/** 节点执行结果状态；skipped 表示分支未命中而非执行失败。 */
export type NodeExecutionStatus = "completed" | "failed" | "skipped";

/** 节点执行器返回给 Runtime 调度器的标准结果。 */
export type NodeExecutionResult = {
  /** 节点最终状态。 */
  status: NodeExecutionStatus;
  /** 写入 Workflow 上下文的可序列化输出。 */
  output: Record<string, unknown>;
  /** Condition 节点选择的出口 Handle。 */
  nextHandle?: string;
};

/** 节点流式执行期间产生的增量事件。 */
export type NodeExecutionEvent =
  { type: "token"; data: { content: string } } | { type: "result"; data: NodeExecutionResult };

/** Runtime 传给单个节点执行器的受控执行上下文。 */
export type WorkflowNodeExecutionRequest = {
  /** 已编译并通过发布校验的节点配置。 */
  node: CompiledWorkflowNode;
  /** 当前 Workflow 的输入、节点输出与运行元数据。 */
  context: WorkflowContext;
  /** 上游取消或超时时用于终止外部调用。 */
  signal?: AbortSignal;
};

/** Workflow 节点执行器契约；实现可返回一次性结果或流式事件。 */
export interface WorkflowNodeExecutor {
  /** 与编译节点 type 对应的唯一执行器类型。 */
  readonly type: string;
  execute(
    request: WorkflowNodeExecutionRequest
  ): Promise<NodeExecutionResult> | AsyncIterable<NodeExecutionEvent>;
}
