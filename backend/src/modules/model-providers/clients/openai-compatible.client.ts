import { HttpStatus, Injectable } from '@nestjs/common';

import { AppError, ErrorCodes } from '../../../core/errors';
import {
  ChatCompletionResponse,
  ChatStreamChunk,
  ProviderChatRequest,
  ProviderRuntimeConfig,
} from '../dto/llm.dto';
import { ProviderClient } from './base.client';

type OpenAIChatChoice = {
  message?: {
    content?: string;
  };
  delta?: {
    content?: string;
  };
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
    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      content,
      model: data.model ?? config.modelName,
      providerId: config.providerId,
      providerType: config.providerType,
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
          yield { type: 'done' };
          return;
        }

        const token = this.parseToken(event);

        if (token) {
          yield { type: 'token', content: token };
        }
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
      messages: request.messages,
      stream,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    };
  }

  private parseStreamLine(line: string): string | null {
    const trimmed = line.trim();

    if (!trimmed || !trimmed.startsWith('data:')) {
      return null;
    }

    return trimmed.slice('data:'.length).trim();
  }

  private parseToken(event: string): string {
    try {
      const data = JSON.parse(event) as OpenAIChatResponse;
      return data.choices?.[0]?.delta?.content ?? '';
    } catch {
      return '';
    }
  }

  private async toProviderError(response: Response): Promise<AppError> {
    const text = await response.text();
    const detail = text ? `: ${text.slice(0, 500)}` : '';

    return new AppError(
      ErrorCodes.provider.connectionFailed,
      `provider request failed with ${response.status} ${response.statusText}${detail}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
