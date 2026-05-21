import { HttpStatus, Injectable } from '@nestjs/common';
import { ModelProvider, ModelProviderType } from '@prisma/client';

import { decryptSecret } from '../../core/crypto';
import { AppError, ErrorCodes } from '../../core/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderClient } from './clients/base.client';
import { OllamaClient } from './clients/ollama.client';
import { OpenAICompatibleClient } from './clients/openai-compatible.client';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatStreamChunk,
  ProviderRuntimeConfig,
} from './dto/llm.dto';

type ModelConfigWithProvider = {
  id: string;
  modelName: string;
  timeoutSeconds: number;
  maxTokens: number | null;
  provider: ModelProvider;
};

@Injectable()
export class ModelProvidersGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAICompatibleClient: OpenAICompatibleClient,
    private readonly ollamaClient: OllamaClient,
  ) {}

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { config, messages, timeoutMs } = await this.prepareChatCall(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.getClient(config.providerType).createChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        tools: this.normalizeTools(request.tools),
        toolChoice: request.toolChoice,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
    }
  }

  async *streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatStreamChunk> {
    const { config, messages, timeoutMs } = await this.prepareChatCall(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      yield* this.getClient(config.providerType).streamChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        tools: this.normalizeTools(request.tools),
        toolChoice: request.toolChoice,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
    }
  }

  private async prepareChatCall(request: ChatCompletionRequest): Promise<{
    config: ProviderRuntimeConfig;
    messages: ChatMessage[];
    timeoutMs: number;
  }> {
    const modelConfig = await this.findModelConfig(request.modelConfigId);
    const timeoutSeconds = request.timeoutSeconds ?? modelConfig.timeoutSeconds;

    return {
      config: {
        providerId: modelConfig.provider.id,
        providerType: modelConfig.provider.providerType,
        baseUrl: modelConfig.provider.baseUrl,
        apiKey: modelConfig.provider.apiKeyEncrypted
          ? decryptSecret(modelConfig.provider.apiKeyEncrypted)
          : '',
        modelName: modelConfig.modelName,
        timeoutSeconds,
        maxTokens: modelConfig.maxTokens,
      },
      messages: this.requireMessages(request.messages),
      timeoutMs: timeoutSeconds * 1000,
    };
  }

  private async findModelConfig(id: string): Promise<ModelConfigWithProvider> {
    const modelConfig = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        enabled: true,
        deletedAt: null,
        provider: {
          enabled: true,
          deletedAt: null,
        },
      },
      select: {
        id: true,
        modelName: true,
        timeoutSeconds: true,
        maxTokens: true,
        provider: true,
      },
    });

    if (!modelConfig) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        'model config not found or disabled',
        HttpStatus.NOT_FOUND,
      );
    }

    return modelConfig;
  }

  private requireMessages(messages: ChatMessage[]): ChatMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, 'messages is required');
    }

    return messages.map((message) => {
      if (
        !message ||
        (
          message.role !== 'system' &&
          message.role !== 'user' &&
          message.role !== 'assistant' &&
          message.role !== 'tool'
        ) ||
        !this.isValidMessageContent(message.content, message)
      ) {
        throw new AppError(ErrorCodes.common.badRequest, 'messages is invalid');
      }

      return {
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content.trim()
            : message.content,
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
      };
    });
  }

  private normalizeTools(tools: ChatCompletionRequest['tools']): ChatCompletionRequest['tools'] {
    if (!tools) {
      return undefined;
    }

    if (!Array.isArray(tools)) {
      throw new AppError(ErrorCodes.common.badRequest, 'tools is invalid');
    }

    return tools.map((tool) => {
      if (
        !tool ||
        typeof tool.name !== 'string' ||
        tool.name.trim().length === 0 ||
        typeof tool.description !== 'string' ||
        !tool.parameters ||
        typeof tool.parameters !== 'object' ||
        Array.isArray(tool.parameters)
      ) {
        throw new AppError(ErrorCodes.common.badRequest, 'tools is invalid');
      }

      return {
        name: tool.name.trim(),
        description: tool.description,
        parameters: tool.parameters,
      };
    });
  }

  private isValidMessageContent(content: unknown, message?: ChatMessage): boolean {
    if (message?.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return typeof content === 'string';
    }

    if (typeof content === 'string') {
      return content.trim().length > 0;
    }

    if (!Array.isArray(content) || content.length === 0) {
      return false;
    }

    return content.every((part) => {
      if (!part || typeof part !== 'object') {
        return false;
      }

      if ('type' in part && part.type === 'text') {
        return 'text' in part && typeof part.text === 'string' && part.text.trim().length > 0;
      }

      if ('type' in part && part.type === 'image_url') {
        const imageUrl = 'image_url' in part ? part.image_url : null;

        return (
          !!imageUrl &&
          typeof imageUrl === 'object' &&
          'url' in imageUrl &&
          typeof imageUrl.url === 'string' &&
          imageUrl.url.startsWith('data:image/')
        );
      }

      return false;
    });
  }

  private getClient(providerType: ModelProviderType): ProviderClient {
    if (providerType === ModelProviderType.OLLAMA) {
      return this.ollamaClient;
    }

    if (providerType === ModelProviderType.OPENAI_COMPATIBLE) {
      return this.openAICompatibleClient;
    }

    throw new AppError(
      ErrorCodes.provider.connectionFailed,
      `${providerType} chat completion is not supported yet`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private normalizeProviderError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return new AppError(
        ErrorCodes.provider.connectionFailed,
        'provider request timeout',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    return new AppError(
      ErrorCodes.provider.connectionFailed,
      error instanceof Error ? error.message : 'provider request failed',
      HttpStatus.BAD_GATEWAY,
    );
  }
}
