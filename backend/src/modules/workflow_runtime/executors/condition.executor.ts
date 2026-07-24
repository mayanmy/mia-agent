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
export class ConditionNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "condition";

  /** 条件值仍由表达式求值器读取，比较器本身不接收自由文本表达式。 */
  constructor(private readonly expressionResolver: WorkflowExpressionResolver) {}

  /** 按配置顺序选择首个命中 Handle，全部不命中时走显式 defaultHandle。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const branches = request.node.config.branches;
    const defaultHandle = request.node.config.defaultHandle;
    if (!Array.isArray(branches) || typeof defaultHandle !== "string") {
      throw this.invalid(request.node.id, "Condition 配置无效");
    }

    for (const rawBranch of branches) {
      if (!this.isRecord(rawBranch)) throw this.invalid(request.node.id, "Condition 分支无效");
      const branch = rawBranch as Record<string, CompiledValue>;
      const handle = branch.handle;
      const operator = branch.operator;
      if (typeof handle !== "string" || typeof operator !== "string") {
        throw this.invalid(request.node.id, "Condition 分支缺少 handle 或 operator");
      }
      const left = this.expressionResolver.resolve(
        branch.left,
        request.context,
        request.node.id,
        operator === "exists"
      );
      const right =
        branch.right === undefined
          ? undefined
          : this.expressionResolver.resolve(branch.right, request.context, request.node.id);
      if (this.compare(operator, left, right, request.node.id)) {
        return { status: "completed", output: { matched: true, handle }, nextHandle: handle };
      }
    }
    return {
      status: "completed",
      output: { matched: false, handle: defaultHandle },
      nextHandle: defaultHandle
    };
  }

  /** 比较操作保持类型严格；只有 eq/neq 支持结构化 JSON 的值比较。 */
  private compare(operator: string, left: unknown, right: unknown, nodeId: string): boolean {
    if (operator === "exists") return left !== undefined && left !== null;
    if (operator === "eq") return this.equal(left, right);
    if (operator === "neq") return !this.equal(left, right);
    if (operator === "contains") {
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      if (Array.isArray(left)) return left.some((item) => this.equal(item, right));
      throw this.invalid(nodeId, "contains 只支持字符串或数组");
    }
    if (typeof left === "number" && typeof right === "number") {
      if (operator === "gt") return left > right;
      if (operator === "gte") return left >= right;
      if (operator === "lt") return left < right;
      if (operator === "lte") return left <= right;
    } else if (typeof left === "string" && typeof right === "string") {
      if (operator === "gt") return left > right;
      if (operator === "gte") return left >= right;
      if (operator === "lt") return left < right;
      if (operator === "lte") return left <= right;
    }
    if (["gt", "gte", "lt", "lte"].includes(operator)) {
      throw this.invalid(nodeId, `${operator} 两侧必须是相同类型的数字或字符串`);
    }
    throw this.invalid(nodeId, `不支持的 Condition 操作符: ${operator}`);
  }

  /** JSON 结构按序列化值比较，基础类型按严格相等比较。 */
  private equal(left: unknown, right: unknown): boolean {
    if (left && right && typeof left === "object" && typeof right === "object") {
      return JSON.stringify(left) === JSON.stringify(right);
    }
    return left === right;
  }

  /** Condition 分支必须是普通对象，不能接受数组或标量。 */
  private isRecord(value: unknown): value is Record<string, CompiledValue> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** 所有条件错误统一归类，防止底层 TypeError 暴露到 Runtime Event。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_condition_invalid", message, nodeId);
  }
}
