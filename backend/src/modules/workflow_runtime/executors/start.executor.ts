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
export class StartNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "start";

  /** 校验调用输入并应用默认值，后续 input 引用统一读取归一化后的 Context。 */
  constructor(private readonly expressionResolver: WorkflowExpressionResolver) {}

  /** Start 输出等于规范化输入，同时更新本次运行隔离的 Context.input。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const definitions = request.node.config.inputs;
    if (!Array.isArray(definitions)) throw this.invalid(request.node.id, "inputs 必须是数组");
    const normalized: Record<string, unknown> = {};

    for (const rawDefinition of definitions) {
      if (!this.isRecord(rawDefinition)) {
        throw this.invalid(request.node.id, "输入定义无效");
      }
      const definition = rawDefinition as Record<string, CompiledValue>;
      if (typeof definition.name !== "string") {
        throw this.invalid(request.node.id, "输入定义无效");
      }
      const name = definition.name;
      let value = request.context.input[name];
      if (value === undefined && definition.defaultValue !== undefined) {
        value = this.expressionResolver.resolve(
          definition.defaultValue,
          request.context,
          request.node.id
        );
      }
      if (value === undefined || value === null) {
        if (definition.required === true) {
          throw this.invalid(request.node.id, `缺少必填输入: ${name}`);
        }
        continue;
      }
      if (!this.matchesType(value, String(definition.type))) {
        throw this.invalid(request.node.id, `输入 ${name} 类型必须为 ${definition.type}`);
      }
      normalized[name] = value;
    }

    request.context.input = normalized;
    return { status: "completed", output: normalized };
  }

  /** 输入类型使用严格 JSON 类型判断，不做字符串到数字等隐式转换。 */
  private matchesType(value: unknown, type: string): boolean {
    if (type === "array") return Array.isArray(value);
    if (type === "object") return this.isRecord(value);
    return typeof value === type;
  }

  /** 数组不能被 object 输入接收，保持 Graph DTO 的两种类型语义独立。 */
  private isRecord(value: unknown): value is Record<string, CompiledValue> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** 输入错误统一带 Start 节点 ID，便于画布定位。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_input_invalid", message, nodeId);
  }
}
