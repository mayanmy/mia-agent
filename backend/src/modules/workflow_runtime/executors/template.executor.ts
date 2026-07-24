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
export class TemplateNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "template";

  /** Template 只依赖受控表达式求值器，不允许执行脚本或访问 Secret。 */
  constructor(private readonly expressionResolver: WorkflowExpressionResolver) {}

  /** 模板结果固定输出为 text，供后续节点使用 `nodes.<id>.output.text` 引用。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const template = request.node.config.template;
    const text = this.expressionResolver.resolve(
      template as CompiledValue,
      request.context,
      request.node.id
    );
    if (typeof text !== "string") {
      throw new WorkflowRuntimeError(
        "workflow_output_invalid",
        "Template 解析结果必须是字符串",
        request.node.id
      );
    }
    return { status: "completed", output: { text } };
  }
}
