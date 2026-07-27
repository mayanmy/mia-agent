import { Injectable } from "@nestjs/common";

import { ToolJsonValue } from "../../tools/dto/tool.dto";
import { ToolsService } from "../../tools/tools.service";
import {
  NodeExecutionResult,
  WorkflowNodeExecutionRequest,
  WorkflowNodeExecutor
} from "../dto/node-execution.dto";
import { WorkflowExpressionResolver } from "../expression-resolver";
import { WorkflowRuntimeError } from "../workflow-runtime.error";

@Injectable()
export class ToolNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "tool";

  /** Tool 节点只调用 ToolsService，因此 HTTP 安全、动态鉴权、Token 刷新和日志保持单一实现。 */
  constructor(
    private readonly toolsService: ToolsService,
    private readonly expressionResolver: WorkflowExpressionResolver
  ) {}

  /** Tool 默认失败即终止；continue 只返回结构化错误，不自动重试可能有副作用的请求。 */
  async execute(request: WorkflowNodeExecutionRequest): Promise<NodeExecutionResult> {
    const config = this.expressionResolver.resolveConfig(
      request.node.config,
      request.context,
      request.node.id
    );
    const toolId = this.requireString(config.toolId, "toolId", request.node.id);
    const input = this.requireToolInput(config.arguments, request.node.id);
    const failurePolicy = config.failurePolicy ?? "fail";
    if (failurePolicy !== "fail" && failurePolicy !== "continue") {
      throw this.invalid(request.node.id, "failurePolicy 只支持 fail 或 continue");
    }

    const result = await this.toolsService.executeTool({
      toolId,
      input,
      requestId: request.context.runtime.requestId,
      runId: request.context.runtime.runId,
      userId: request.context.runtime.userId,
      agentId: request.context.runtime.agentId,
      signal: request.signal
    });
    if (!result.ok) {
      if (request.signal?.aborted || result.errorType === "canceled") {
        throw new WorkflowRuntimeError("workflow_canceled", "Workflow 已取消", request.node.id);
      }
      const error = {
        type: result.errorType || "tool_failed",
        message: result.errorMessage || "工具执行失败"
      };
      if (failurePolicy === "continue") {
        return {
          status: "completed",
          output: { ok: false, toolId, error, elapsedMs: result.elapsedMs }
        };
      }
      throw new WorkflowRuntimeError("workflow_tool_failed", error.message, request.node.id);
    }

    return {
      status: "completed",
      output: {
        ok: true,
        toolId,
        body: result.output ?? null,
        elapsedMs: result.elapsedMs
      }
    };
  }

  /** toolId 在发布时已校验，运行时仍拒绝空值以保护历史版本。 */
  private requireString(value: unknown, field: string, nodeId: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw this.invalid(nodeId, `${field} 必须是非空字符串`);
    }
    return value.trim();
  }

  /** 工具参数必须是 JSON 对象；递归转换会拒绝 undefined、函数和 BigInt。 */
  private requireToolInput(value: unknown, nodeId: string): Record<string, ToolJsonValue> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw this.invalid(nodeId, "arguments 必须是对象");
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.toToolJson(item, nodeId)])
    );
  }

  /** ToolsService DTO 只接受标准 JSON，避免特殊 JS 值穿过工具边界。 */
  private toToolJson(value: unknown, nodeId: string): ToolJsonValue {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => this.toToolJson(item, nodeId));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.toToolJson(item, nodeId)])
      );
    }
    throw this.invalid(nodeId, "arguments 包含不可序列化值");
  }

  /** 工具配置错误统一归类为不可重试的输出协议问题。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_output_invalid", message, nodeId);
  }
}
