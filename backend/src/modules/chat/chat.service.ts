import { HttpStatus, Injectable } from '@nestjs/common';

import { AppError, ErrorCodes } from '../../core/errors';
import { AgentsService } from '../agents/agents.service';
import { ModelProvidersService } from '../model-providers/model-providers.service';
import { ChatMessage } from '../model-providers/dto/llm.dto';
import {
  ChatFileAttachmentDto,
  ChatImageAttachmentDto,
  ChatCompletionDto,
  ChatCompletionResult,
  ChatMessageDto,
  ChatStreamEvent,
} from './dto/chat.dto';

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;
const MAX_FILE_COUNT = 4;
const MAX_FILE_CONTENT_LENGTH = 200_000;

@Injectable()
export class ChatService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly modelProvidersService: ModelProvidersService,
  ) {}

  async createCompletion(payload: ChatCompletionDto): Promise<ChatCompletionResult> {
    const agentId = this.requireNonEmptyString(payload.agentId, 'agentId');
    const images = this.normalizeImages(payload.images);
    const files = this.normalizeFiles(payload.files);
    const message = this.normalizeUserMessage(payload.message, images, files);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    this.ensureImageInputSupported(agent.modelName, images);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);

    const response = await this.modelProvidersService.createChatCompletion({
      modelConfigId: agent.modelConfigId,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        ...history,
        this.buildUserMessage(message, images, files),
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
    const files = this.normalizeFiles(payload.files);
    const message = this.normalizeUserMessage(payload.message, images, files);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    this.ensureImageInputSupported(agent.modelName, images);
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
        this.buildUserMessage(message, images, files),
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

      if (
        (role !== 'user' && role !== 'assistant') ||
        content.length === 0
      ) {
        return [];
      }

      return [
        {
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

  private normalizeUserMessage(
    value: unknown,
    images: ChatImageAttachmentDto[],
    files: ChatFileAttachmentDto[],
  ): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (images.length > 0) {
      return '请分析这张图片。';
    }

    if (files.length > 0) {
      return '请阅读并分析这些文件内容。';
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

  private normalizeFiles(value: unknown): ChatFileAttachmentDto[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.common.badRequest, 'files must be an array');
    }

    if (value.length > MAX_FILE_COUNT) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `files cannot exceed ${MAX_FILE_COUNT} items`,
      );
    }

    return value.map((item) => {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const mimeType = typeof item?.mimeType === 'string' ? item.mimeType.trim() : '';
      const size = Number(item?.size);
      const content = typeof item?.content === 'string' ? item.content : '';

      if (!name || !Number.isFinite(size) || size < 0 || content.trim().length === 0) {
        throw new AppError(ErrorCodes.common.badRequest, 'files is invalid');
      }

      if (content.length > MAX_FILE_CONTENT_LENGTH) {
        throw new AppError(ErrorCodes.common.badRequest, 'file content is too large');
      }

      return {
        name,
        mimeType,
        size,
        content,
      };
    });
  }

  private buildUserMessage(
    content: string,
    images: ChatImageAttachmentDto[],
    files: ChatFileAttachmentDto[],
  ): ChatMessage {
    const textContent = this.appendFileContext(content, files);

    if (images.length === 0) {
      return {
        role: 'user',
        content: textContent,
      };
    }

    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text: textContent,
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

  private appendFileContext(content: string, files: ChatFileAttachmentDto[]): string {
    if (files.length === 0) {
      return content;
    }

    const fileContext = files
      .map((file, index) => {
        return [
          `文件 ${index + 1}: ${file.name}`,
          `MIME: ${file.mimeType || 'text/plain'}`,
          '内容:',
          '```',
          file.content,
          '```',
        ].join('\n');
      })
      .join('\n\n');

    return `${content}\n\n以下是用户上传的文件内容，请作为上下文参考：\n\n${fileContext}`;
  }

  private ensureImageInputSupported(modelName: string, images: ChatImageAttachmentDto[]): void {
    if (images.length === 0) {
      return;
    }

    if (this.isLikelyVisionModel(modelName)) {
      return;
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      `当前模型 ${modelName} 不支持图片输入，请切换到视觉模型，例如 qwen-vl-max、qwen2.5-vl 或其他支持 image input 的模型。`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private isLikelyVisionModel(modelName: string): boolean {
    const normalized = modelName.toLowerCase();
    const visionModelKeywords = [
      'vl',
      'vision',
      'omni',
      'qvq',
      'gpt-4o',
      'gpt-4.1',
      'gemini',
      'claude-3',
      'claude-4',
    ];

    return visionModelKeywords.some((keyword) => normalized.includes(keyword));
  }
}
