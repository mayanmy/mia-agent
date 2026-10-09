import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError, ErrorCodes } from "../../../core/errors";
import {
  ChatMessage,
  ChatCompletionResponse,
  EmbeddingResponse,
  ChatStreamChunk,
  LLMToolCall,
  ProviderChatRequest,
  ProviderEmbeddingRequest,
  ProviderRuntimeConfig
} from "../dto/llm.dto";
import { ProviderClient } from "./base.client";

/** OpenAI-compatible 非流式/流式响应中的工具调用原始结构。 */
type OpenAIToolCall = {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

/** 流式工具调用会把名称和参数拆成多个 delta，需要按 index 重组。 */
type OpenAIStreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

/** 只声明 Mia 实际消费的 Choice 字段，避免上层依赖供应商完整响应。 */
type OpenAIChatChoice = {
  message?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: OpenAIToolCall[];
  };
  delta?: {
    content?: string;
    reasoning_content?: string;
    tool_calls?: OpenAIStreamToolCallDelta[];
  };
  finish_reason?: string | null;
};

type OpenAIChatResponse = {
  model?: string;
  choices?: OpenAIChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAIEmbeddingResponse = {
  model?: string;
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

@Injectable()
export class OpenAICompatibleClient implements ProviderClient {
  /** 将 OpenAI-compatible 非流式协议归一化为 Mia DTO。 */
  async createChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildBody(config, request, false)),
      signal: request.signal
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";
    const reasoningContent = message?.reasoning_content ?? "";
    const toolCalls = this.parseToolCalls(message?.tool_calls);

    return {
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      model: data.model ?? config.modelName,
      providerId: config.providerId,
      providerType: config.providerType,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens
          }
        : undefined
    };
  }

  async createEmbedding(
    config: ProviderRuntimeConfig,
    request: ProviderEmbeddingRequest
  ): Promise<EmbeddingResponse> {
    const response = await fetch(this.getEmbeddingsUrl(config.baseUrl), {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify({
        model: config.modelName,
        input: request.input
      }),
      signal: request.signal
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    // 部分兼容供应商不会按请求顺序返回 data，必须按 index 还原批量输入顺序。
    const embeddings = [...(data.data ?? [])]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding)
      .filter((embedding): embedding is number[] => Array.isArray(embedding));

    if (embeddings.length === 0) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        "provider embedding response is empty",
        HttpStatus.BAD_GATEWAY
      );
    }

    return {
      embeddings,
      model: data.model ?? config.modelName,
      providerId: config.providerId,
      providerType: config.providerType,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            totalTokens: data.usage.total_tokens
          }
        : undefined
    };
  }

  /** 逐行解析 SSE，并在本层完成跨 chunk 的工具调用参数拼接。 */
  async *streamChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest
  ): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(this.getChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildBody(config, request, true)),
      signal: request.signal
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    if (!response.body) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        "provider response body is empty",
        HttpStatus.BAD_GATEWAY
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    // 同一轮可能并行生成多个工具调用，index 是流式 delta 唯一稳定的归并键。
    const toolCallAccumulator = new Map<number, OpenAIToolCall>();
    let toolCallsEmitted = false;

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = this.parseStreamLine(line);

        if (!event) {
          continue;
        }

        if (event === "[DONE]") {
          // 某些兼容实现不返回 finish_reason=tool_calls，只能在 DONE 时补发已累积调用。
          if (!toolCallsEmitted) {
            for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
              yield { type: "tool_call", toolCall };
            }
          }

          yield { type: "done" };
          return;
        }

        const streamEvent = this.parseStreamEvent(event);

        if (!streamEvent) {
          continue;
        }

        if (streamEvent.reasoningContent) {
          yield { type: "reasoning_token", content: streamEvent.reasoningContent };
        }

        if (streamEvent.content) {
          yield { type: "token", content: streamEvent.content };
        }

        this.mergeToolCallDeltas(toolCallAccumulator, streamEvent.toolCallDeltas);

        if (streamEvent.finishReason === "tool_calls") {
          // 标记后避免随后的 [DONE] 再次触发同一批工具。
          toolCallsEmitted = true;

          for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
            yield { type: "tool_call", toolCall };
          }
        }
      }
    }

    // 上游若直接关闭连接但已经形成完整工具调用，仍尽量交付，避免静默丢失。
    if (!toolCallsEmitted) {
      for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
        yield { type: "tool_call", toolCall };
      }
    }

    yield { type: "done" };
  }

  protected getChatCompletionsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
  }

  protected getEmbeddingsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/u, "")}/embeddings`;
  }

  protected buildHeaders(config: ProviderRuntimeConfig): HeadersInit {
    return {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    };
  }

  protected buildBody(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
    stream: boolean
  ): Record<string, unknown> {
    return {
      model: config.modelName,
      messages: request.messages.map((message) => this.buildMessage(message)),
      stream,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      // 仅正整数才下发；null/undefined 表示沿用供应商默认值。
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
              }
            })),
            tool_choice: request.toolChoice ?? "auto"
          }
        : {})
    };
  }

  private buildMessage(message: ChatMessage): Record<string, unknown> {
    // tool 结果必须携带原 tool_call_id，供应商才能把结果关联回 assistant 调用。
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content
      };
    }

    return {
      role: message.role,
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: toolCall.rawArguments || JSON.stringify(toolCall.arguments)
              }
            }))
          }
        : {})
    };
  }

  private parseStreamLine(line: string): string | null {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith("data:")) {
      return null;
    }

    return trimmed.slice("data:".length).trim();
  }

  private parseStreamEvent(event: string): {
    content: string;
    reasoningContent: string;
    toolCallDeltas: OpenAIStreamToolCallDelta[];
    finishReason: string | null;
  } | null {
    try {
      const data = JSON.parse(event) as OpenAIChatResponse;
      const choice = data.choices?.[0];

      return {
        content: choice?.delta?.content ?? "",
        reasoningContent: choice?.delta?.reasoning_content ?? "",
        toolCallDeltas: choice?.delta?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? null
      };
    } catch {
      // 兼容供应商偶尔会混入心跳或非 JSON data 行，忽略单行而不中断整个流。
      return null;
    }
  }

  private mergeToolCallDeltas(
    accumulator: Map<number, OpenAIToolCall>,
    deltas: OpenAIStreamToolCallDelta[]
  ): void {
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const current = accumulator.get(index) ?? {
        id: "",
        type: "function" as const,
        function: {
          name: "",
          arguments: ""
        }
      };

      // arguments 是字符串增量，必须按到达顺序拼接，不能逐段尝试 JSON.parse。
      accumulator.set(index, {
        id: delta.id ?? current.id,
        type: delta.type ?? current.type,
        function: {
          name: delta.function?.name ?? current.function?.name,
          arguments: `${current.function?.arguments ?? ""}${delta.function?.arguments ?? ""}`
        }
      });
    }
  }

  private parseToolCalls(toolCalls: OpenAIToolCall[] | undefined): LLMToolCall[] {
    if (!Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls.flatMap((toolCall) => {
      const id = toolCall.id ?? "";
      const name = toolCall.function?.name ?? "";
      const rawArguments = toolCall.function?.arguments ?? "";

      if (!id || !name) {
        return [];
      }

      return [
        {
          id,
          name,
          rawArguments,
          arguments: this.parseToolCallArguments(rawArguments)
        }
      ];
    });
  }

  private parseToolCallArguments(rawArguments: string): Record<string, unknown> {
    if (!rawArguments) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawArguments) as unknown;

      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return {};
      }

      return parsed as Record<string, unknown>;
    } catch {
      // 保留 rawArguments 供上层记录排障，结构化参数降级为空对象交由工具校验拒绝。
      return {};
    }
  }

  private async toProviderError(response: Response): Promise<AppError> {
    // 错误正文会进入管理员日志，因此在解析阶段统一限制长度，避免超大响应污染日志。
    const text = await response.text();
    const message = this.extractProviderErrorMessage(text);
    const detail = message ? `: ${message}` : "";

    return new AppError(
      ErrorCodes.provider.connectionFailed,
      `provider request failed with ${response.status} ${response.statusText}${detail}`,
      HttpStatus.BAD_GATEWAY
    );
  }

  private extractProviderErrorMessage(text: string): string {
    if (!text) {
      return "";
    }

    try {
      const data = JSON.parse(text) as {
        error?: {
          message?: string;
          code?: string;
        };
      };
      const message = data.error?.message ?? text;

      if (message.includes("Unexpected item type in content")) {
        return "当前模型不支持图片输入，请切换到视觉模型后重试。";
      }

      return message.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  }
}
