import { HttpStatus, Injectable } from '@nestjs/common';

import { AppError, ErrorCodes } from '../../core/errors';
import { AgentsService } from '../agents/agents.service';
import { ModelProvidersService } from '../model-providers/model-providers.service';
import { ChatMessage } from '../model-providers/dto/llm.dto';
import {
  ChatImageAttachmentDto,
  ChatCompletionDto,
  ChatCompletionResult,
  ChatMessageDto,
  ChatStreamEvent,
} from './dto/chat.dto';

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;

@Injectable()
export class ChatService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly modelProvidersService: ModelProvidersService,
  ) {}

  async createCompletion(payload: ChatCompletionDto): Promise<ChatCompletionResult> {
    const agentId = this.requireNonEmptyString(payload.agentId, 'agentId');
    const images = this.normalizeImages(payload.images);
    const message = this.normalizeUserMessage(payload.message, images);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);

    const response = await this.modelProvidersService.createChatCompletion({
      modelConfigId: agent.modelConfigId,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        ...history,
        this.buildUserMessage(message, images),
      ],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
    });

    return {
      agentId: agent.agentId,
      modelConfigId: agent.modelConfigId,
      modelName: response.model || agent.modelName,
      providerName: agent.providerType,
      content: response.content,
    };
  }

  async *streamCompletion(
    payload: ChatCompletionDto,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const agentId = this.requireNonEmptyString(payload.agentId, 'agentId');
    const images = this.normalizeImages(payload.images);
    const message = this.normalizeUserMessage(payload.message, images);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);

    yield {
      type: 'message_start',
      data: {
        agentId: agent.agentId,
        modelConfigId: agent.modelConfigId,
        modelName: agent.modelName,
        providerName: agent.providerType,
      },
    };

    for await (const chunk of this.modelProvidersService.streamChatCompletion({
      modelConfigId: agent.modelConfigId,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        ...history,
        this.buildUserMessage(message, images),
      ],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      signal,
    })) {
      if (chunk.type === 'token' && chunk.content) {
        yield {
          type: 'token',
          data: {
            content: chunk.content,
          },
        };
      }

      if (chunk.type === 'done') {
        yield {
          type: 'message_end',
          data: {},
        };
        return;
      }

      if (chunk.type === 'error') {
        yield {
          type: 'error',
          data: {
            message: chunk.errorMessage || 'model stream failed',
          },
        };
        return;
      }
    }

    yield {
      type: 'message_end',
      data: {},
    };
  }

  private normalizeHistory(history: ChatMessageDto[] | undefined, maxTurns: number): ChatMessage[] {
    if (!Array.isArray(history) || maxTurns <= 0) {
      return [];
    }

    const normalized = history.flatMap((item): ChatMessage[] => {
      const role = item?.role;
      const content = typeof item?.content === 'string' ? item.content.trim() : '';
      const images = role === 'user' ? this.normalizeImages(item?.images) : [];

      if (
        (role !== 'user' && role !== 'assistant') ||
        (content.length === 0 && images.length === 0)
      ) {
        return [];
      }

      return [
        role === 'user'
          ? this.buildUserMessage(this.normalizeUserMessage(content, images), images)
          : {
          role,
          content,
        },
      ];
    });

    return normalized.slice(-maxTurns * 2);
  }

  private requireNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `${fieldName} is required`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return value.trim();
  }

  private normalizeUserMessage(value: unknown, images: ChatImageAttachmentDto[]): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (images.length > 0) {
      return '请分析这张图片。';
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      'message or images is required',
      HttpStatus.BAD_REQUEST,
    );
  }

  private normalizeImages(value: unknown): ChatImageAttachmentDto[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.common.badRequest, 'images must be an array');
    }

    if (value.length > MAX_IMAGE_COUNT) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `images cannot exceed ${MAX_IMAGE_COUNT} items`,
      );
    }

    return value.map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const mimeType = typeof item?.mimeType === 'string' ? item.mimeType.trim() : '';
      const dataUrl = typeof item?.dataUrl === 'string' ? item.dataUrl.trim() : '';

      if (!name || !mimeType.startsWith('image/') || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
        throw new AppError(ErrorCodes.common.badRequest, 'images is invalid');
      }

      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        throw new AppError(ErrorCodes.common.badRequest, 'image is too large');
      }

      return {
        name,
        mimeType,
        dataUrl,
      };
    });
  }

  private buildUserMessage(content: string, images: ChatImageAttachmentDto[]): ChatMessage {
    if (images.length === 0) {
      return {
        role: 'user',
        content,
      };
    }

    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text: content,
        },
        ...images.map((image) => ({
          type: 'image_url' as const,
          image_url: {
            url: image.dataUrl,
          },
        })),
      ],
    };
  }
}
