import { Injectable } from "@nestjs/common";

import { ChatMessage } from "../../model-providers/dto/llm.dto";
import { ModelProvidersService } from "../../model-providers/model-providers.service";
import {
  NodeExecutionEvent,
  WorkflowNodeExecutionRequest,
  WorkflowNodeExecutor
} from "../dto/node-execution.dto";
import { WorkflowExpressionResolver } from "../expression-resolver";
import { WorkflowRuntimeError } from "../workflow-runtime.error";

const MAX_LLM_OUTPUT_BYTES = 1024 * 1024;

@Injectable()
export class LlmNodeExecutor implements WorkflowNodeExecutor {
  readonly type = "llm";

  /** LLM 节点只通过模型网关公开服务调用 Provider，继续复用并发、重试、熔断和取消。 */
  constructor(
    private readonly modelProvidersService: ModelProvidersService,
    private readonly expressionResolver: WorkflowExpressionResolver
  ) {}

  /** 流式 Token 直接交给 Workflow Runtime，最终 result 保存稳定的 text/structured 输出协议。 */
  async *execute(request: WorkflowNodeExecutionRequest): AsyncIterable<NodeExecutionEvent> {
    const config = this.expressionResolver.resolveConfig(
      request.node.config,
      request.context,
      request.node.id
    );
    const modelConfigId = this.requireString(
      config.modelConfigId,
      "modelConfigId",
      request.node.id
    );
    const prompt = this.requireString(config.prompt, "prompt", request.node.id, true);
    const systemPrompt = this.optionalString(config.systemPrompt, "systemPrompt", request.node.id);
    const responseFormat = config.responseFormat ?? "text";
    if (responseFormat !== "text" && responseFormat !== "json_object") {
      throw this.invalid(request.node.id, "responseFormat 只支持 text 或 json_object");
    }
    const temperature = this.optionalNumber(
      config.temperature,
      "temperature",
      request.node.id,
      0,
      2
    );
    const maxTokens = this.optionalPositiveInteger(config.maxTokens, "maxTokens", request.node.id);
    const timeoutSeconds = this.optionalPositiveNumber(
      config.timeoutSeconds,
      "timeoutSeconds",
      request.node.id
    );
    const messages: ChatMessage[] = [
      ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
      { role: "user", content: prompt }
    ];
    let content = "";

    try {
      for await (const chunk of this.modelProvidersService.streamChatCompletion({
        modelConfigId,
        messages,
        temperature,
        maxTokens,
        timeoutSeconds,
        signal: request.signal
      })) {
        if (chunk.type === "token" && chunk.content) {
          content += chunk.content;
          if (Buffer.byteLength(content, "utf8") > MAX_LLM_OUTPUT_BYTES) {
            throw new WorkflowRuntimeError(
              "workflow_context_too_large",
              `LLM 输出不能超过 ${MAX_LLM_OUTPUT_BYTES} 字节`,
              request.node.id
            );
          }
          yield { type: "token", data: { content: chunk.content } };
        } else if (chunk.type === "tool_call") {
          throw this.invalid(request.node.id, "Workflow LLM 节点不允许返回 Tool Call");
        } else if (chunk.type === "error") {
          throw new WorkflowRuntimeError(
            "workflow_model_failed",
            chunk.errorMessage || "模型流式调用失败",
            request.node.id,
            true
          );
        }
      }
    } catch (error) {
      if (error instanceof WorkflowRuntimeError) throw error;
      if (request.signal?.aborted) throw this.canceled(request.node.id);
      throw new WorkflowRuntimeError(
        "workflow_model_failed",
        error instanceof Error && error.message ? error.message : "模型调用失败",
        request.node.id,
        true
      );
    }

    const output: Record<string, unknown> = { text: content };
    if (responseFormat === "json_object")
      output.structured = this.parseJsonObject(content, request.node.id);
    yield { type: "result", data: { status: "completed", output } };
  }

  /** JSON Object 模式严格解析完整输出，禁止从 Markdown 或混合文本中猜测 JSON。 */
  private parseJsonObject(content: string, nodeId: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw this.invalid(nodeId, "模型输出不是有效 JSON Object");
    }
  }

  /** 必填字符串可按字段决定是否允许空文本；Prompt 允许编译后为空字符串。 */
  private requireString(value: unknown, field: string, nodeId: string, allowEmpty = false): string {
    if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
      throw this.invalid(nodeId, `${field} 必须是字符串`);
    }
    return value;
  }

  /** 可选字符串存在时必须保持类型，避免 Provider 请求收到对象。 */
  private optionalString(value: unknown, field: string, nodeId: string): string | undefined {
    return value === undefined ? undefined : this.requireString(value, field, nodeId, true);
  }

  /** temperature 等浮点参数保持显式范围，不进行字符串数值转换。 */
  private optionalNumber(
    value: unknown,
    field: string,
    nodeId: string,
    minimum: number,
    maximum: number
  ): number | undefined {
    if (value === undefined) return undefined;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw this.invalid(nodeId, `${field} 必须在 ${minimum}-${maximum} 之间`);
    }
    return value;
  }

  /** maxTokens 必须是正整数，防止小数或负数传入 Provider。 */
  private optionalPositiveInteger(
    value: unknown,
    field: string,
    nodeId: string
  ): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw this.invalid(nodeId, `${field} 必须是正整数`);
    }
    return Number(value);
  }

  /** Provider timeoutSeconds 允许小数，但必须大于零。 */
  private optionalPositiveNumber(
    value: unknown,
    field: string,
    nodeId: string
  ): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw this.invalid(nodeId, `${field} 必须是正数`);
    }
    return value;
  }

  /** 配置或输出协议错误统一归类为不可重试。 */
  private invalid(nodeId: string, message: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_output_invalid", message, nodeId);
  }

  /** AbortSignal 取消不应被包装成可重试的 Provider 故障。 */
  private canceled(nodeId: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_canceled", "Workflow 已取消", nodeId);
  }
}
