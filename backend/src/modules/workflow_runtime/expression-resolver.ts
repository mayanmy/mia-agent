import { Injectable } from "@nestjs/common";

import {
  CompiledReference,
  CompiledTemplate,
  CompiledValue
} from "../workflows/dto/compiled-plan.dto";
import { WorkflowContext } from "./workflow-context";
import { WorkflowRuntimeError } from "./workflow-runtime.error";

@Injectable()
export class WorkflowExpressionResolver {
  /** 递归求值 CompiledValue；缺失引用直接失败，不能悄悄替换为空字符串。 */
  resolve(
    value: CompiledValue,
    context: WorkflowContext,
    nodeId?: string,
    allowMissing = false
  ): unknown {
    if (this.isReference(value)) {
      return this.resolveReference(value, context, nodeId, allowMissing);
    }
    if (this.isTemplate(value)) return this.resolveTemplate(value, context, nodeId);
    if (Array.isArray(value)) {
      return value.map((item) => this.resolve(item, context, nodeId, allowMissing));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.resolve(item, context, nodeId, allowMissing)
        ])
      );
    }
    return value;
  }

  /** 配置对象必须保持对象形态，防止异常 Plan 把节点配置解析成标量。 */
  resolveConfig(
    value: Record<string, CompiledValue>,
    context: WorkflowContext,
    nodeId: string
  ): Record<string, unknown> {
    const resolved = this.resolve(value, context, nodeId);
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
      throw new WorkflowRuntimeError(
        "workflow_output_invalid",
        "节点配置解析结果必须是对象",
        nodeId
      );
    }
    return resolved as Record<string, unknown>;
  }

  /** 静态路径逐段读取 Context，并拒绝 inherited property 和不存在的字段。 */
  private resolveReference(
    reference: CompiledReference,
    context: WorkflowContext,
    nodeId?: string,
    allowMissing = false
  ): unknown {
    let current: unknown = context[reference.source];
    for (const segment of reference.path) {
      const compatibleValue = this.resolveLegacyOutputAlias(current, segment);
      if (compatibleValue.found) {
        current = compatibleValue.value;
        continue;
      }
      if (
        !current ||
        typeof current !== "object" ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        if (allowMissing) return undefined;
        throw new WorkflowRuntimeError(
          "workflow_reference_missing",
          `变量不存在: ${reference.source}.${reference.path.join(".")}`,
          nodeId
        );
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  /**
   * 兼容早期发布版本使用的 output.body。
   * 新编辑器公开 Tool.result 和 LLM.structured，旧 Compiled Plan 无需重新发布也能继续运行。
   */
  private resolveLegacyOutputAlias(
    current: unknown,
    segment: string
  ): { found: boolean; value?: unknown } {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { found: false };
    }
    const record = current as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, segment)) {
      return { found: true, value: record[segment] };
    }
    if (segment === "result" && Object.prototype.hasOwnProperty.call(record, "body")) {
      return { found: true, value: record.body };
    }
    if (segment === "structured" && Object.prototype.hasOwnProperty.call(record, "body")) {
      return { found: true, value: record.body };
    }
    if (segment === "body" && Object.prototype.hasOwnProperty.call(record, "result")) {
      return { found: true, value: record.result };
    }
    if (segment === "body" && Object.prototype.hasOwnProperty.call(record, "structured")) {
      return { found: true, value: record.structured };
    }
    return { found: false };
  }

  /** 混合模板中的对象和数组使用 JSON 序列化，避免出现 [object Object]。 */
  private resolveTemplate(
    template: CompiledTemplate,
    context: WorkflowContext,
    nodeId?: string
  ): string {
    return template.segments
      .map((segment) => {
        if (typeof segment === "string") return segment;
        const value = this.resolveReference(segment, context, nodeId);
        return value && typeof value === "object" ? JSON.stringify(value) : String(value);
      })
      .join("");
  }

  /** kind 和必要字段同时匹配才按引用处理，普通业务对象不会被误判。 */
  private isReference(value: CompiledValue): value is CompiledReference {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "reference" &&
      "source" in value &&
      "path" in value
    );
  }

  /** Template AST 只接受编译器生成的 segments 数组。 */
  private isTemplate(value: CompiledValue): value is CompiledTemplate {
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.kind === "template" &&
      "segments" in value
    );
  }
}
