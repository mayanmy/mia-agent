import { Buffer } from "node:buffer";

import { Injectable } from "@nestjs/common";
import Ajv, { ValidateFunction } from "ajv";

import { ToolJsonValue } from "../tools/dto/tool.dto";
import { McpProtocolClientFactory } from "./clients/mcp-protocol-client.factory";
import { McpProtocolToolResult } from "./clients/mcp-protocol.client";
import { McpRuntimeToolConfig } from "./dto/mcp-runtime.dto";

type PendingPermit = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type ServerSemaphore = {
  active: number;
  limit: number;
  queue: PendingPermit[];
};

export class McpToolExecutionError extends Error {
  constructor(
    readonly errorType: string,
    message: string
  ) {
    super(message);
  }
}

@Injectable()
export class McpToolExecutor {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly semaphores = new Map<string, ServerSemaphore>();

  constructor(private readonly clientFactory: McpProtocolClientFactory) {}

  /**
   * MCP Tool 默认不重试，因为远端操作是否幂等不可知。超时和上游取消共用同一个
   * AbortSignal，并在 finally 中关闭连接、释放并发槽位，避免慢 Server 占满 Runtime。
   */
  async execute(
    config: McpRuntimeToolConfig,
    input: Record<string, ToolJsonValue>,
    upstreamSignal?: AbortSignal
  ): Promise<ToolJsonValue> {
    this.validateArguments(config, input);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort("mcp_tool_timeout"),
      config.client.toolTimeoutMs
    );
    const abortUpstream = () => controller.abort(upstreamSignal?.reason ?? "canceled");
    upstreamSignal?.addEventListener("abort", abortUpstream, { once: true });
    let release: (() => void) | undefined;
    let client: ReturnType<McpProtocolClientFactory["create"]> | undefined;

    try {
      release = await this.acquire(config.serverId, config.maxConcurrency, controller.signal);
      client = this.clientFactory.create(config.client);
      await this.connectWithRetry(client, controller.signal);
      const result = await client.callTool(config.remoteName, input, controller.signal);
      return this.adaptResult(result, config);
    } catch (error) {
      if (error instanceof McpToolExecutionError) throw error;
      if (controller.signal.aborted) {
        const timeout = !upstreamSignal?.aborted;
        throw new McpToolExecutionError(
          timeout ? "mcp_tool_timeout" : "canceled",
          timeout ? "MCP 工具调用超时" : "MCP 工具调用已取消"
        );
      }
      const message = error instanceof Error ? error.message : "MCP 协议调用失败";
      throw new McpToolExecutionError(this.classifyProtocolError(message), message);
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener("abort", abortUpstream);
      await client?.close().catch(() => undefined);
      release?.();
    }
  }

  /** 只重试建连阶段一次；callTool 可能有副作用，发送后绝不能自动重放。 */
  private async connectWithRetry(
    client: ReturnType<McpProtocolClientFactory["create"]>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await client.connect(signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.isTransientConnectionError(message) || signal.aborted) throw error;
      await this.delay(250 + Math.floor(Math.random() * 150), signal);
      await client.connect(signal);
    }
  }

  private isTransientConnectionError(message: string): boolean {
    return /fetch failed|network|ECONN|EAI_AGAIN|ETIMEDOUT|socket|HTTP 5\d\d/i.test(message);
  }

  private classifyProtocolError(message: string): string {
    if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message)) return "mcp_auth_required";
    if (this.isTransientConnectionError(message)) return "mcp_network_error";
    return "mcp_protocol_error";
  }

  private delay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("MCP 重连等待已取消", "AbortError"));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  /** Schema 编译结果按同步哈希缓存；Schema 更新后自然生成新的校验器。 */
  private validateArguments(
    config: McpRuntimeToolConfig,
    input: Record<string, ToolJsonValue>
  ): void {
    let validator = this.validators.get(config.schemaHash);
    try {
      validator ??= this.ajv.compile(config.inputSchema);
      this.validators.set(config.schemaHash, validator);
    } catch (error) {
      throw new McpToolExecutionError(
        "mcp_protocol_error",
        `MCP Tool Schema 无法编译：${error instanceof Error ? error.message : "invalid schema"}`
      );
    }

    if (!validator(input)) {
      const details = this.ajv.errorsText(validator.errors, { separator: "; " });
      throw new McpToolExecutionError("mcp_invalid_arguments", `MCP 工具参数不合法：${details}`);
    }
  }

  /** 协议结果先执行硬字节限制，再转成适合模型上下文和日志的纯 JSON。 */
  private adaptResult(result: McpProtocolToolResult, config: McpRuntimeToolConfig): ToolJsonValue {
    const raw = JSON.stringify(result);
    if (Buffer.byteLength(raw, "utf8") > config.maxResponseBytes) {
      throw new McpToolExecutionError("mcp_output_too_large", "MCP Tool 返回内容超过硬限制");
    }
    if (result.isError) {
      throw new McpToolExecutionError("mcp_tool_error", this.errorContent(result));
    }

    const output =
      result.structuredContent !== undefined
        ? (result.structuredContent as ToolJsonValue)
        : this.contentOutput(result);
    return this.truncateOutput(output, config.maxOutputChars);
  }

  private contentOutput(result: McpProtocolToolResult): ToolJsonValue {
    const textParts: string[] = [];
    let unsupportedMedia = 0;

    for (const item of result.content) {
      if (item.type === "text" && typeof item.text === "string") {
        textParts.push(item.text);
      } else if (item.type === "image" || item.type === "audio") {
        unsupportedMedia += 1;
      } else {
        textParts.push(JSON.stringify(item));
      }
    }
    if (unsupportedMedia > 0) {
      textParts.push(`[${unsupportedMedia} 个媒体结果未写入模型上下文]`);
    }
    return textParts.join("\n");
  }

  private errorContent(result: McpProtocolToolResult): string {
    const text = result.content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => String(item.text))
      .join("\n");
    return text.slice(0, 2_000) || "MCP Server 返回工具业务错误";
  }

  /** 软限制保留头尾，既控制模型上下文，也保留错误末尾等诊断信息。 */
  private truncateOutput(output: ToolJsonValue, maxChars: number): ToolJsonValue {
    const serialized = typeof output === "string" ? output : JSON.stringify(output);
    if (serialized.length <= maxChars) return output;
    const headLength = Math.floor(maxChars * 0.7);
    const tailLength = Math.max(0, maxChars - headLength);
    return {
      truncated: true,
      originalChars: serialized.length,
      preview: `${serialized.slice(0, headLength)}\n...[MCP output truncated]...\n${serialized.slice(-tailLength)}`
    };
  }

  /** 简单 FIFO semaphore；排队期间取消会移除 waiter，不消耗后续槽位。 */
  private acquire(serverId: string, limit: number, signal: AbortSignal): Promise<() => void> {
    const semaphore = this.semaphores.get(serverId) ?? { active: 0, limit, queue: [] };
    semaphore.limit = limit;
    this.semaphores.set(serverId, semaphore);

    return new Promise((resolve, reject) => {
      const grant = () => {
        semaphore.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          semaphore.active -= 1;
          this.drain(semaphore);
        });
      };
      if (signal.aborted) {
        reject(new DOMException("MCP 并发等待已取消", "AbortError"));
        return;
      }
      if (semaphore.active < semaphore.limit) {
        grant();
        return;
      }

      const pending: PendingPermit = { resolve, reject, signal };
      pending.onAbort = () => {
        const index = semaphore.queue.indexOf(pending);
        if (index >= 0) semaphore.queue.splice(index, 1);
        reject(new DOMException("MCP 并发等待已取消", "AbortError"));
      };
      signal.addEventListener("abort", pending.onAbort, { once: true });
      semaphore.queue.push(pending);
    });
  }

  private drain(semaphore: ServerSemaphore): void {
    while (semaphore.active < semaphore.limit && semaphore.queue.length > 0) {
      const pending = semaphore.queue.shift()!;
      pending.signal?.removeEventListener("abort", pending.onAbort!);
      semaphore.active += 1;
      let released = false;
      pending.resolve(() => {
        if (released) return;
        released = true;
        semaphore.active -= 1;
        this.drain(semaphore);
      });
    }
  }
}
