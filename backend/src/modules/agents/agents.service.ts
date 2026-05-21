import { HttpStatus, Injectable } from '@nestjs/common';
import { ModelConfigType, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { AppError, ErrorCodes } from '../../core/errors';
import { createPageResult, normalizePageQuery } from '../../core/pagination';
import { PageResult } from '../../core/result';
import { ModelProvidersService } from '../model-providers/model-providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ToolsService } from '../tools/tools.service';
import {
  AgentCreateDto,
  AgentDetail,
  AgentGenerationParams,
  AgentListItem,
  AgentModelConfigSummary,
  AgentPublishResult,
  AgentQueryDto,
  AgentRuntimeConfig,
  AgentToolBindingDto,
  AgentToolBindingResult,
  AgentUpdateDto,
  SharedAgentDetail,
} from './dto/agent.dto';

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_HISTORY_TURNS = 6;

type AgentWithModelConfig = Prisma.AgentGetPayload<{
  include: {
    modelConfig: {
      include: {
        provider: true;
      };
    };
    agentTools: true;
    _count: {
      select: {
        agentTools: true;
      };
    };
  };
}>;

type AgentCreateData = {
  name: string;
  description: string;
  systemPrompt: string;
  modelConfigId: string | null;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  generationParams: AgentGenerationParams | null;
  enabled: boolean;
};

type AgentUpdateData = Partial<Omit<AgentCreateData, 'modelConfigId'>> & {
  modelConfigId?: string;
};

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvidersService: ModelProvidersService,
    private readonly toolsService: ToolsService,
  ) {}

  async listAgents(query: AgentQueryDto): Promise<PageResult<AgentListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.AgentWhereInput = {
      deletedAt: null,
      ...(query.enabled !== undefined ? { enabled: this.parseEnabled(query.enabled) } : {}),
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.agent.findMany({
        where,
        include: {
          modelConfig: {
            include: {
              provider: true,
            },
          },
          agentTools: true,
          _count: {
            select: {
              agentTools: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return createPageResult(
      list.map((agent) => this.toAgentListItem(agent)),
      total,
      page.page,
      page.pageSize,
    );
  }

  async createAgent(payload: AgentCreateDto): Promise<AgentDetail> {
    const data = this.validateAgentCreate(payload);
    const modelConfigId = await this.resolveCreateModelConfigId(data.modelConfigId);
    await this.ensureChatModelConfig(modelConfigId);

    const agent = await this.prisma.agent.create({
      data: {
        name: data.name,
        description: data.description,
        systemPrompt: data.systemPrompt,
        modelConfig: {
          connect: { id: modelConfigId },
        },
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        timeoutSeconds: data.timeoutSeconds,
        historyTurns: data.historyTurns,
        generationParams: this.toPrismaJson(data.generationParams),
        enabled: data.enabled,
      },
      include: {
        modelConfig: {
          include: {
            provider: true,
          },
        },
        agentTools: true,
        _count: {
          select: {
            agentTools: true,
          },
        },
      },
    });

    return this.toAgentDetail(agent);
  }

  async getAgent(id: string): Promise<AgentDetail> {
    const agent = await this.findAgentDetail(id);
    return this.toAgentDetail(agent);
  }

  async updateAgent(id: string, payload: AgentUpdateDto): Promise<AgentDetail> {
    await this.ensureAgentExists(id);
    const data = this.validateAgentUpdate(payload);

    if (data.modelConfigId) {
      await this.ensureChatModelConfig(data.modelConfigId);
    }

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
        ...(data.modelConfigId !== undefined
          ? {
              modelConfig: {
                connect: { id: data.modelConfigId },
              },
            }
          : {}),
        ...(data.temperature !== undefined ? { temperature: data.temperature } : {}),
        ...(data.maxTokens !== undefined ? { maxTokens: data.maxTokens } : {}),
        ...(data.timeoutSeconds !== undefined ? { timeoutSeconds: data.timeoutSeconds } : {}),
        ...(data.historyTurns !== undefined ? { historyTurns: data.historyTurns } : {}),
        ...(data.generationParams !== undefined
          ? { generationParams: this.toPrismaJson(data.generationParams) }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
      include: {
        modelConfig: {
          include: {
            provider: true,
          },
        },
        agentTools: true,
        _count: {
          select: {
            agentTools: true,
          },
        },
      },
    });

    return this.toAgentDetail(agent);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.ensureAgentExists(id);

    await this.prisma.agent.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        enabled: false,
      },
    });
  }

  async publishAgent(id: string): Promise<AgentPublishResult> {
    await this.ensureAgentExists(id);
    const existing = await this.prisma.agent.findUnique({
      where: { id },
      select: {
        shareToken: true,
      },
    });
    const shareToken = existing?.shareToken || this.createShareToken();

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        published: true,
        publishedAt: new Date(),
        shareToken,
      },
      select: {
        id: true,
        published: true,
        publishedAt: true,
        shareToken: true,
      },
    });

    return {
      agentId: agent.id,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken,
    };
  }

  async unpublishAgent(id: string): Promise<AgentPublishResult> {
    await this.ensureAgentExists(id);

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        published: false,
        publishedAt: null,
      },
      select: {
        id: true,
        published: true,
        publishedAt: true,
        shareToken: true,
      },
    });

    return {
      agentId: agent.id,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken,
    };
  }

  async getSharedAgent(token: string): Promise<SharedAgentDetail> {
    const shareToken = this.requireNonEmptyString(token, 'token');
    const agent = await this.prisma.agent.findFirst({
      where: {
        shareToken,
        published: true,
        enabled: true,
        deletedAt: null,
      },
      include: {
        modelConfig: {
          include: {
            provider: true,
          },
        },
      },
    });

    if (!agent) {
      throw new AppError(ErrorCodes.agent.notFound, 'shared agent not found', HttpStatus.NOT_FOUND);
    }

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelName: agent.modelConfig.modelName,
      providerName: agent.modelConfig.provider.name,
    };
  }

  async getAgentRuntimeConfig(id: string): Promise<AgentRuntimeConfig> {
    const agent = await this.findAgentDetail(id);

    if (!agent.enabled) {
      throw new AppError(ErrorCodes.agent.notFound, 'agent not found', HttpStatus.NOT_FOUND);
    }

    return {
      agentId: agent.id,
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      modelConfigId: agent.modelConfigId,
      modelName: agent.modelConfig.modelName,
      providerId: agent.modelConfig.providerId,
      providerType: agent.modelConfig.provider.providerType,
      baseUrl: agent.modelConfig.provider.baseUrl,
      temperature: Number(agent.temperature),
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      historyTurns: agent.historyTurns,
      generationParams: this.toGenerationParams(agent.generationParams),
      knowledgeBaseIds: [],
      toolIds: agent.agentTools.map((tool) => tool.toolId),
    };
  }

  async getAgentTools(id: string): Promise<AgentToolBindingResult> {
    await this.ensureAgentExists(id);

    const tools = await this.prisma.agentTool.findMany({
      where: {
        agentId: id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      agentId: id,
      toolIds: tools.map((tool) => tool.toolId),
    };
  }

  async updateAgentTools(
    id: string,
    payload: AgentToolBindingDto,
  ): Promise<AgentToolBindingResult> {
    await this.ensureAgentExists(id);
    const toolIds = this.normalizeToolIds(payload.toolIds);
    this.ensureToolIdsExist(toolIds);

    await this.prisma.$transaction([
      this.prisma.agentTool.deleteMany({
        where: {
          agentId: id,
        },
      }),
      ...(toolIds.length > 0
        ? [
            this.prisma.agentTool.createMany({
              data: toolIds.map((toolId) => ({
                agentId: id,
                toolId,
              })),
            }),
          ]
        : []),
    ]);

    return {
      agentId: id,
      toolIds,
    };
  }

  private validateAgentCreate(payload: AgentCreateDto): AgentCreateData {
    return {
      name: this.requireNonEmptyString(payload.name, 'name'),
      description: this.normalizeDescription(payload.description),
      systemPrompt: this.requireNonEmptyString(payload.systemPrompt, 'systemPrompt'),
      modelConfigId: this.normalizeOptionalId(payload.modelConfigId),
      temperature: this.normalizeTemperature(payload.temperature),
      maxTokens: this.normalizeMaxTokens(payload.maxTokens),
      timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds),
      historyTurns: this.normalizeHistoryTurns(payload.historyTurns),
      generationParams: this.normalizeGenerationParams(payload.generationParams),
      enabled: payload.enabled ?? true,
    };
  }

  private validateAgentUpdate(payload: AgentUpdateDto): AgentUpdateData {
    return {
      ...(payload.name !== undefined
        ? { name: this.requireNonEmptyString(payload.name, 'name') }
        : {}),
      ...(payload.description !== undefined
        ? { description: this.normalizeDescription(payload.description) }
        : {}),
      ...(payload.systemPrompt !== undefined
        ? { systemPrompt: this.requireNonEmptyString(payload.systemPrompt, 'systemPrompt') }
        : {}),
      ...(payload.modelConfigId !== undefined
        ? { modelConfigId: this.requireNonEmptyString(payload.modelConfigId, 'modelConfigId') }
        : {}),
      ...(payload.temperature !== undefined
        ? { temperature: this.normalizeTemperature(payload.temperature) }
        : {}),
      ...(payload.maxTokens !== undefined
        ? { maxTokens: this.normalizeMaxTokens(payload.maxTokens) }
        : {}),
      ...(payload.timeoutSeconds !== undefined
        ? { timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds) }
        : {}),
      ...(payload.historyTurns !== undefined
        ? { historyTurns: this.normalizeHistoryTurns(payload.historyTurns) }
        : {}),
      ...(payload.generationParams !== undefined
        ? { generationParams: this.normalizeGenerationParams(payload.generationParams) }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalId(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return this.requireNonEmptyString(value, 'modelConfigId');
  }

  private normalizeDescription(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new AppError(ErrorCodes.common.badRequest, 'description must be a string');
    }

    return value.trim();
  }

  private normalizeTemperature(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_TEMPERATURE;
    }

    const temperature = Number(value);

    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        'temperature must be a number between 0 and 2',
      );
    }

    return Number(temperature.toFixed(2));
  }

  private normalizeMaxTokens(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const maxTokens = Number(value);

    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AppError(ErrorCodes.common.badRequest, 'maxTokens must be a positive integer');
    }

    return maxTokens;
  }

  private normalizeTimeout(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_TIMEOUT_SECONDS;
    }

    const timeout = Number(value);

    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        'timeoutSeconds must be an integer between 1 and 300',
      );
    }

    return timeout;
  }

  private normalizeHistoryTurns(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_HISTORY_TURNS;
    }

    const historyTurns = Number(value);

    if (!Number.isInteger(historyTurns) || historyTurns < 0 || historyTurns > 20) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        'historyTurns must be an integer between 0 and 20',
      );
    }

    return historyTurns;
  }

  private normalizeGenerationParams(value: unknown): AgentGenerationParams | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (!this.isPlainObject(value)) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        'generationParams must be an object or null',
      );
    }

    return value;
  }

  private normalizeToolIds(value: unknown): string[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.agent.invalidTools, 'toolIds must be an array');
    }

    const toolIds = value.map((item) => {
      if (typeof item !== 'string' || item.trim().length === 0) {
        throw new AppError(ErrorCodes.agent.invalidTools, 'toolIds must contain non-empty strings');
      }

      return item.trim();
    });

    if (toolIds.length > 50) {
      throw new AppError(ErrorCodes.agent.invalidTools, 'toolIds cannot exceed 50 items');
    }

    return [...new Set(toolIds)];
  }

  private ensureToolIdsExist(toolIds: string[]): void {
    if (toolIds.length === 0) {
      return;
    }

    const availableToolIds = new Set(
      this.toolsService.getToolDefinitions(toolIds).map((tool) => tool.id),
    );
    const missingToolIds = toolIds.filter((toolId) => !availableToolIds.has(toolId));

    if (missingToolIds.length > 0) {
      throw new AppError(
        ErrorCodes.agent.invalidTools,
        `unknown or disabled toolIds: ${missingToolIds.join(', ')}`,
      );
    }
  }

  private parseEnabled(value: string): boolean {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new AppError(ErrorCodes.common.badRequest, 'enabled must be true or false');
  }

  private async ensureAgentExists(id: string): Promise<void> {
    const existing = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      throw new AppError(ErrorCodes.agent.notFound, 'agent not found', HttpStatus.NOT_FOUND);
    }
  }

  private createShareToken(): string {
    return randomBytes(18).toString('base64url');
  }

  private async resolveCreateModelConfigId(modelConfigId: string | null): Promise<string> {
    if (modelConfigId) {
      return modelConfigId;
    }

    const defaultModelConfigId = await this.modelProvidersService.getDefaultChatModelConfigId();

    if (!defaultModelConfigId) {
      throw new AppError(
        ErrorCodes.agent.invalidModelConfig,
        'default chat model is not configured',
      );
    }

    return defaultModelConfigId;
  }

  private async ensureChatModelConfig(id: string): Promise<void> {
    const modelConfig = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        deletedAt: null,
        enabled: true,
        modelType: ModelConfigType.CHAT,
        provider: {
          deletedAt: null,
          enabled: true,
        },
      },
      select: {
        id: true,
      },
    });

    if (!modelConfig) {
      throw new AppError(
        ErrorCodes.agent.invalidModelConfig,
        'modelConfigId must reference an enabled chat model',
      );
    }
  }

  private async findAgentDetail(id: string): Promise<AgentWithModelConfig> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        modelConfig: {
          include: {
            provider: true,
          },
        },
        agentTools: true,
        _count: {
          select: {
            agentTools: true,
          },
        },
      },
    });

    if (!agent) {
      throw new AppError(ErrorCodes.agent.notFound, 'agent not found', HttpStatus.NOT_FOUND);
    }

    return agent;
  }

  private toAgentListItem(agent: AgentWithModelConfig): AgentListItem {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelConfigId: agent.modelConfigId,
      modelName: agent.modelConfig.modelName,
      providerName: agent.modelConfig.provider.name,
      toolCount: agent._count.agentTools,
      temperature: Number(agent.temperature),
      enabled: agent.enabled,
      published: agent.published,
      publishedAt: agent.publishedAt,
      shareToken: agent.shareToken,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    };
  }

  private toAgentDetail(agent: AgentWithModelConfig): AgentDetail {
    return {
      ...this.toAgentListItem(agent),
      systemPrompt: agent.systemPrompt,
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      historyTurns: agent.historyTurns,
      generationParams: this.toGenerationParams(agent.generationParams),
      toolIds: agent.agentTools.map((tool) => tool.toolId),
      modelConfig: this.toModelConfigSummary(agent),
    };
  }

  private toModelConfigSummary(agent: AgentWithModelConfig): AgentModelConfigSummary {
    return {
      id: agent.modelConfig.id,
      modelName: agent.modelConfig.modelName,
      modelType: agent.modelConfig.modelType,
      providerId: agent.modelConfig.providerId,
      providerName: agent.modelConfig.provider.name,
      providerType: agent.modelConfig.provider.providerType,
    };
  }

  private toGenerationParams(value: Prisma.JsonValue | null): AgentGenerationParams | null {
    if (!this.isPlainObject(value)) {
      return null;
    }

    return value;
  }

  private toPrismaJson(
    value: AgentGenerationParams | null,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === null ? Prisma.JsonNull : value;
  }

  private isPlainObject(value: unknown): value is AgentGenerationParams {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }
}
