import { Injectable } from "@nestjs/common";

import { CompiledValue } from "../../workflows/dto/compiled-plan.dto";
import {
  NodeExecutionResult,
  WorkflowNodeExecutionRequest,
  WorkflowNodeExecutor
} from "../dto/node-execution.dto";
import { WorkflowExpressionResolver } from "../expression-resolver";
import { WorkflowRuntimeError } from "../workflow-runtime.error";

@Injectable()
export class EndNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "end";

  /** End 使用同一表达式规则组装最终结构化输出和可选 Chat answer。 */
  constructor(private readonly expressionResolver: WorkflowExpressionResolver) {}

  /** End 输出即 Workflow 最终结果；answer 如存在必须为字符串。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const output = this.expressionResolver.resolve(
      request.node.config.output as CompiledValue,
      request.context,
      request.node.id
    );
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      throw this.invalid(request.node.id, "End output 必须解析为对象");
    }
    const answerValue = request.node.config.answer;
    if (answerValue === undefined) {
      return { status: "completed", output: output as Record<string, unknown> };
    }
    const answer = this.expressionResolver.resolve(answerValue, request.context, request.node.id);
    if (typeof answer !== "string") throw this.invalid(request.node.id, "End answer 必须是字符串");
    return { status: "completed", output: { ...(output as Record<string, unknown>), answer } };
  }

  /** 输出协议错误携带 End 节点 ID，供调用方定位画布配置。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_output_invalid", message, nodeId);
  }
}
