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
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.getClient(config.providerType).createChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async *streamChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatStreamChunk> {
    const { config, messages, timeoutMs } = await this.prepareChatCall(request);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      yield* this.getClient(config.providerType).streamChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        signal: controller.signal,
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
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
        (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.content !== 'string' ||
        message.content.trim().length === 0
      ) {
        throw new AppError(ErrorCodes.common.badRequest, 'messages is invalid');
      }

      return {
        role: message.role,
        content: message.content.trim(),
      };
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
