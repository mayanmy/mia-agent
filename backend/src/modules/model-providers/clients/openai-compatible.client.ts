import { HttpStatus, Injectable } from '@nestjs/common';

import { AppError, ErrorCodes } from '../../../core/errors';
import {
  ChatMessage,
  ChatCompletionResponse,
  ChatStreamChunk,
  LLMToolCall,
  ProviderChatRequest,
  ProviderRuntimeConfig,
} from '../dto/llm.dto';
import { ProviderClient } from './base.client';

type OpenAIToolCall = {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAIStreamToolCallDelta = {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAIChatChoice = {
  message?: {
    content?: string;
    tool_calls?: OpenAIToolCall[];
  };
  delta?: {
    content?: string;
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

@Injectable()
export class OpenAICompatibleClient implements ProviderClient {
  async createChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): Promise<ChatCompletionResponse> {
    const response = await fetch(this.getChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildBody(config, request, false)),
      signal: request.signal,
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? '';
    const toolCalls = this.parseToolCalls(message?.tool_calls);

    return {
      content,
      model: data.model ?? config.modelName,
      providerId: config.providerId,
      providerType: config.providerType,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *streamChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
  ): AsyncIterable<ChatStreamChunk> {
    const response = await fetch(this.getChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildBody(config, request, true)),
      signal: request.signal,
    });

    if (!response.ok) {
      throw await this.toProviderError(response);
    }

    if (!response.body) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        'provider response body is empty',
        HttpStatus.BAD_GATEWAY,
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallAccumulator = new Map<number, OpenAIToolCall>();
    let toolCallsEmitted = false;

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const event = this.parseStreamLine(line);

        if (!event) {
          continue;
        }

        if (event === '[DONE]') {
          if (!toolCallsEmitted) {
            for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
              yield { type: 'tool_call', toolCall };
            }
          }

          yield { type: 'done' };
          return;
        }

        const streamEvent = this.parseStreamEvent(event);

        if (!streamEvent) {
          continue;
        }

        if (streamEvent.content) {
          yield { type: 'token', content: streamEvent.content };
        }

        this.mergeToolCallDeltas(toolCallAccumulator, streamEvent.toolCallDeltas);

        if (streamEvent.finishReason === 'tool_calls') {
          toolCallsEmitted = true;

          for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
            yield { type: 'tool_call', toolCall };
          }
        }
      }
    }

    if (!toolCallsEmitted) {
      for (const toolCall of this.parseToolCalls([...toolCallAccumulator.values()])) {
        yield { type: 'tool_call', toolCall };
      }
    }

    yield { type: 'done' };
  }

  protected getChatCompletionsUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/u, '')}/chat/completions`;
  }

  protected buildHeaders(config: ProviderRuntimeConfig): HeadersInit {
    return {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  protected buildBody(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest,
    stream: boolean,
  ): Record<string, unknown> {
    return {
      model: config.modelName,
      messages: request.messages.map((message) => this.buildMessage(message)),
      stream,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: request.toolChoice ?? 'auto',
          }
        : {}),
    };
  }

  private buildMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    return {
      role: message.role,
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: toolCall.rawArguments || JSON.stringify(toolCall.arguments),
              },
            })),
          }
        : {}),
    };
  }

  private parseStreamLine(line: string): string | null {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith('data:')) {
      return null;
    }

    return trimmed.slice('data:'.length).trim();
  }

  private parseStreamEvent(event: string): {
    content: string;
    toolCallDeltas: OpenAIStreamToolCallDelta[];
    finishReason: string | null;
  } | null {
    try {
      const data = JSON.parse(event) as OpenAIChatResponse;
      const choice = data.choices?.[0];

      return {
        content: choice?.delta?.content ?? '',
        toolCallDeltas: choice?.delta?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? null,
      };
    } catch {
      return null;
    }
  }

  private mergeToolCallDeltas(
    accumulator: Map<number, OpenAIToolCall>,
    deltas: OpenAIStreamToolCallDelta[],
  ): void {
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      const current = accumulator.get(index) ?? {
        id: '',
        type: 'function' as const,
        function: {
          name: '',
          arguments: '',
        },
      };

      accumulator.set(index, {
        id: delta.id ?? current.id,
        type: delta.type ?? current.type,
        function: {
          name: delta.function?.name ?? current.function?.name,
          arguments: `${current.function?.arguments ?? ''}${delta.function?.arguments ?? ''}`,
        },
      });
    }
  }

  private parseToolCalls(toolCalls: OpenAIToolCall[] | undefined): LLMToolCall[] {
    if (!Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls.flatMap((toolCall) => {
      const id = toolCall.id ?? '';
      const name = toolCall.function?.name ?? '';
      const rawArguments = toolCall.function?.arguments ?? '';

      if (!id || !name) {
        return [];
      }

      return [
        {
          id,
          name,
          rawArguments,
          arguments: this.parseToolCallArguments(rawArguments),
        },
      ];
    });
  }

  private parseToolCallArguments(rawArguments: string): Record<string, unknown> {
    if (!rawArguments) {
      return {};
    }

    try {
      const parsed = JSON.parse(rawArguments) as unknown;

      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        return {};
      }

      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async toProviderError(response: Response): Promise<AppError> {
    const text = await response.text();
    const message = this.extractProviderErrorMessage(text);
    const detail = message ? `: ${message}` : '';

    return new AppError(
      ErrorCodes.provider.connectionFailed,
      `provider request failed with ${response.status} ${response.statusText}${detail}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  private extractProviderErrorMessage(text: string): string {
    if (!text) {
      return '';
    }

    try {
      const data = JSON.parse(text) as {
        error?: {
          message?: string;
          code?: string;
        };
      };
      const message = data.error?.message ?? text;

      if (message.includes('Unexpected item type in content')) {
        return '当前模型不支持图片输入，请切换到视觉模型后重试。';
      }

      return message.slice(0, 500);
    } catch {
      return text.slice(0, 500);
    }
  }
}
