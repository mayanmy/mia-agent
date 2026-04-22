import { HttpStatus, Injectable } from '@nestjs/common';

import { AppError, ErrorCodes } from '../../core/errors';
import { AgentsService } from '../agents/agents.service';
import { ModelProvidersService } from '../model-providers/model-providers.service';
import { ChatMessage } from '../model-providers/dto/llm.dto';
import { ChatCompletionDto, ChatCompletionResult, ChatMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly modelProvidersService: ModelProvidersService,
  ) {}

  async createCompletion(payload: ChatCompletionDto): Promise<ChatCompletionResult> {
    const agentId = this.requireNonEmptyString(payload.agentId, 'agentId');
    const message = this.requireNonEmptyString(payload.message, 'message');
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);

    const response = await this.modelProvidersService.createChatCompletion({
      modelConfigId: agent.modelConfigId,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        ...history,
        { role: 'user', content: message },
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

  private normalizeHistory(history: ChatMessageDto[] | undefined, maxTurns: number): ChatMessage[] {
    if (!Array.isArray(history) || maxTurns <= 0) {
      return [];
    }

    const normalized = history.flatMap((item): ChatMessage[] => {
      const role = item?.role;
      const content = typeof item?.content === 'string' ? item.content.trim() : '';

      if ((role !== 'user' && role !== 'assistant') || content.length === 0) {
        return [];
      }

      return [{
        role,
        content,
      }];
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
}
