import { HttpStatus, Injectable } from '@nestjs/common';
import { ModelConfigType, ModelProvider, ModelProviderType, Prisma } from '@prisma/client';

import { decryptSecret, encryptSecret } from '../../core/crypto';
import { AppError, ErrorCodes } from '../../core/errors';
import { createPageResult, normalizePageQuery } from '../../core/pagination';
import { PageResult } from '../../core/result';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
} from './dto/llm.dto';
import {
  ModelConfigCreateDto,
  ModelConfigDetail,
  ModelConfigListItem,
  ModelConfigQueryDto,
  ModelConfigUpdateDto,
  ProviderCreateDto,
  ProviderDetail,
  ProviderListItem,
  ProviderQueryDto,
  ProviderTestConnectionResult,
  ProviderUpdateDto,
} from './dto/model-provider.dto';
import { ModelProvidersGateway } from './gateway';

const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_CONTEXT_LENGTH = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

type ProviderTestRequest = {
  requestUrl: string;
  displayUrl: string;
  headers: HeadersInit;
};

@Injectable()
export class ModelProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelProvidersGateway,
  ) {}

  async listProviders(query: ProviderQueryDto): Promise<PageResult<ProviderListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.ModelProviderWhereInput = {
      deletedAt: null,
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.modelProvider.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.modelProvider.count({ where }),
    ]);

    return createPageResult(
      list.map((provider) => this.toProviderListItem(provider)),
      total,
      page.page,
      page.pageSize,
    );
  }

  async createProvider(payload: ProviderCreateDto): Promise<ProviderDetail> {
    const data = this.validateProviderCreate(payload);
    await this.ensureProviderNameAvailable(data.name);

    const provider = await this.prisma.modelProvider.create({
      data: {
        name: data.name,
        providerType: data.providerType,
        baseUrl: data.baseUrl,
        apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey) : null,
        enabled: data.enabled,
      },
      include: { modelConfigs: { where: { deletedAt: null } } },
    });

    return this.toProviderDetail(provider);
  }

  async getProvider(id: string): Promise<ProviderDetail> {
    const provider = await this.findProviderDetail(id);
    return this.toProviderDetail(provider);
  }

  async updateProvider(id: string, payload: ProviderUpdateDto): Promise<ProviderDetail> {
    await this.ensureProviderExists(id);
    const data = this.validateProviderUpdate(payload);

    if (data.name) {
      await this.ensureProviderNameAvailable(data.name, id);
    }

    const provider = await this.prisma.modelProvider.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.providerType ? { providerType: data.providerType } : {}),
        ...(data.baseUrl ? { baseUrl: data.baseUrl } : {}),
        ...(data.apiKey !== undefined
          ? { apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey) : null }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
      include: { modelConfigs: { where: { deletedAt: null } } },
    });

    return this.toProviderDetail(provider);
  }

  async deleteProvider(id: string): Promise<void> {
    await this.ensureProviderExists(id);

    const activeModelConfigCount = await this.prisma.modelConfig.count({
      where: {
        providerId: id,
        deletedAt: null,
      },
    });

    if (activeModelConfigCount > 0) {
      throw new AppError(
        ErrorCodes.provider.inUse,
        'provider has model configs and cannot be deleted',
        HttpStatus.CONFLICT,
      );
    }

    await this.prisma.modelProvider.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  async testProviderConnection(id: string): Promise<ProviderTestConnectionResult> {
    const provider = await this.ensureProviderExists(id);
    const startedAt = Date.now();
    const timeoutMs = 30_000;
    const testRequest = this.getProviderTestRequest(provider);

    try {
      const response = await fetch(testRequest.requestUrl, {
        method: 'GET',
        headers: testRequest.headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || '',
        latencyMs: Date.now() - startedAt,
        url: testRequest.displayUrl,
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        statusText: this.formatProviderConnectionError(provider, testRequest.displayUrl, error),
        latencyMs: Date.now() - startedAt,
        url: testRequest.displayUrl,
      };
    }
  }

  async listModelConfigs(query: ModelConfigQueryDto): Promise<PageResult<ModelConfigListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.ModelConfigWhereInput = {
      deletedAt: null,
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.modelType ? { modelType: query.modelType } : {}),
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.modelConfig.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.modelConfig.count({ where }),
    ]);

    return createPageResult(
      list.map((config) => this.toModelConfigListItem(config)),
      total,
      page.page,
      page.pageSize,
    );
  }

  async createModelConfig(payload: ModelConfigCreateDto): Promise<ModelConfigDetail> {
    const data = this.validateModelConfigCreate(payload);
    await this.ensureProviderExists(data.providerId);
    await this.ensureModelConfigAvailable(data.providerId, data.modelName, data.modelType);

    const config = await this.prisma.modelConfig.create({
      data,
      include: { provider: true },
    });

    return this.toModelConfigDetail(config);
  }

  async getModelConfig(id: string): Promise<ModelConfigDetail> {
    const config = await this.findModelConfigDetail(id);
    return this.toModelConfigDetail(config);
  }

  async updateModelConfig(id: string, payload: ModelConfigUpdateDto): Promise<ModelConfigDetail> {
    const existing = await this.findModelConfigDetail(id);
    const data = this.validateModelConfigUpdate(payload);
    const providerId = data.providerId ?? existing.providerId;
    const modelName = data.modelName ?? existing.modelName;
    const modelType = data.modelType ?? existing.modelType;

    if (data.providerId) {
      await this.ensureProviderExists(data.providerId);
    }

    if (
      providerId !== existing.providerId ||
      modelName !== existing.modelName ||
      modelType !== existing.modelType
    ) {
      await this.ensureModelConfigAvailable(providerId, modelName, modelType, id);
    }

    const config = await this.prisma.modelConfig.update({
      where: { id },
      data,
      include: { provider: true },
    });

    return this.toModelConfigDetail(config);
  }

  async deleteModelConfig(id: string): Promise<void> {
    await this.findModelConfigDetail(id);

    await this.prisma.modelConfig.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    return this.gateway.createChatCompletion(request);
  }

  streamChatCompletion(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    return this.gateway.streamChatCompletion(request);
  }

  private validateProviderCreate(payload: ProviderCreateDto): Required<ProviderCreateDto> {
    return {
      name: this.requireNonEmptyString(payload.name, 'name'),
      providerType: this.requireProviderType(payload.providerType),
      baseUrl: this.requireUrl(payload.baseUrl),
      apiKey: payload.apiKey ?? '',
      enabled: payload.enabled ?? true,
    };
  }

  private validateProviderUpdate(payload: ProviderUpdateDto): ProviderUpdateDto {
    return {
      ...(payload.name !== undefined
        ? { name: this.requireNonEmptyString(payload.name, 'name') }
        : {}),
      ...(payload.providerType !== undefined
        ? { providerType: this.requireProviderType(payload.providerType) }
        : {}),
      ...(payload.baseUrl !== undefined ? { baseUrl: this.requireUrl(payload.baseUrl) } : {}),
      ...(payload.apiKey !== undefined ? { apiKey: payload.apiKey } : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
    };
  }

  private validateModelConfigCreate(payload: ModelConfigCreateDto): Required<ModelConfigCreateDto> {
    return {
      providerId: this.requireNonEmptyString(payload.providerId, 'providerId'),
      modelName: this.requireNonEmptyString(payload.modelName, 'modelName'),
      modelType: this.requireModelType(payload.modelType),
      credentialName: this.normalizeOptionalString(payload.credentialName),
      contextLength: this.normalizeContextLength(payload.contextLength),
      enabled: payload.enabled ?? true,
      timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds),
      maxTokens: this.normalizeMaxTokens(payload.maxTokens),
    };
  }

  private validateModelConfigUpdate(payload: ModelConfigUpdateDto): ModelConfigUpdateDto {
    return {
      ...(payload.providerId !== undefined
        ? { providerId: this.requireNonEmptyString(payload.providerId, 'providerId') }
        : {}),
      ...(payload.modelName !== undefined
        ? { modelName: this.requireNonEmptyString(payload.modelName, 'modelName') }
        : {}),
      ...(payload.modelType !== undefined ? { modelType: this.requireModelType(payload.modelType) } : {}),
      ...(payload.credentialName !== undefined
        ? { credentialName: this.normalizeOptionalString(payload.credentialName) }
        : {}),
      ...(payload.contextLength !== undefined
        ? { contextLength: this.normalizeContextLength(payload.contextLength) }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
      ...(payload.timeoutSeconds !== undefined
        ? { timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds) }
        : {}),
      ...(payload.maxTokens !== undefined ? { maxTokens: this.normalizeMaxTokens(payload.maxTokens) } : {}),
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalString(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value !== 'string') {
      throw new AppError(ErrorCodes.common.badRequest, 'credentialName must be a string');
    }

    return value.trim();
  }

  private requireUrl(value: unknown): string {
    const url = this.requireNonEmptyString(value, 'baseUrl');

    try {
      return new URL(url).toString().replace(/\/$/u, '');
    } catch {
      throw new AppError(ErrorCodes.common.badRequest, 'baseUrl must be a valid URL');
    }
  }

  private requireProviderType(value: unknown): ModelProviderType {
    if (
      value === ModelProviderType.OPENAI_COMPATIBLE ||
      value === ModelProviderType.OLLAMA ||
      value === ModelProviderType.ANTHROPIC ||
      value === ModelProviderType.GEMINI
    ) {
      return value;
    }

    throw new AppError(ErrorCodes.common.badRequest, 'providerType is invalid');
  }

  private requireModelType(value: unknown): ModelConfigType {
    if (value === ModelConfigType.CHAT || value === ModelConfigType.EMBEDDING) {
      return value;
    }

    throw new AppError(ErrorCodes.common.badRequest, 'modelType is invalid');
  }

  private normalizeTimeout(value: unknown): number {
    if (value === undefined || value === null) {
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

  private normalizeContextLength(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_CONTEXT_LENGTH;
    }

    const contextLength = Number(value);

    if (!Number.isInteger(contextLength) || contextLength < 1 || contextLength > 1_000_000) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        'contextLength must be an integer between 1 and 1000000',
      );
    }

    return contextLength;
  }

  private async ensureProviderExists(id: string): Promise<ModelProvider> {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { id, deletedAt: null },
    });

    if (!provider) {
      throw new AppError(ErrorCodes.provider.notFound, 'provider not found', HttpStatus.NOT_FOUND);
    }

    return provider;
  }

  private async ensureProviderNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.modelProvider.findFirst({
      where: {
        name,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.provider.nameExists,
        'provider name already exists',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findProviderDetail(id: string) {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { id, deletedAt: null },
      include: { modelConfigs: { where: { deletedAt: null } } },
    });

    if (!provider) {
      throw new AppError(ErrorCodes.provider.notFound, 'provider not found', HttpStatus.NOT_FOUND);
    }

    return provider;
  }

  private async ensureModelConfigAvailable(
    providerId: string,
    modelName: string,
    modelType: ModelConfigType,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.modelConfig.findFirst({
      where: {
        providerId,
        modelName,
        modelType,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.provider.modelConfigExists,
        'model config already exists',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findModelConfigDetail(id: string) {
    const config = await this.prisma.modelConfig.findFirst({
      where: { id, deletedAt: null },
      include: { provider: true },
    });

    if (!config || config.provider.deletedAt) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        'model config not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return config;
  }

  private getProviderTestRequest(provider: ModelProvider): ProviderTestRequest {
    const apiKey = provider.apiKeyEncrypted ? decryptSecret(provider.apiKeyEncrypted) : '';

    if (provider.providerType === ModelProviderType.OLLAMA) {
      const url = `${this.getOllamaServerBaseUrl(provider.baseUrl)}/api/tags`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      };
    }

    if (provider.providerType === ModelProviderType.OPENAI_COMPATIBLE) {
      const url = `${this.normalizeBaseUrl(provider.baseUrl)}/models`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      };
    }

    if (provider.providerType === ModelProviderType.ANTHROPIC) {
      const url = `${this.normalizeBaseUrl(provider.baseUrl)}/models`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: {
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          'anthropic-version': ANTHROPIC_VERSION,
        },
      };
    }

    if (provider.providerType === ModelProviderType.GEMINI) {
      return this.getGeminiTestRequest(provider.baseUrl, apiKey);
    }

    return {
      requestUrl: provider.baseUrl,
      displayUrl: provider.baseUrl,
      headers: {},
    };
  }

  private getOllamaServerBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/v1$/u, '');
  }

  private getGeminiTestRequest(baseUrl: string, apiKey: string): ProviderTestRequest {
    const url = new URL(`${this.normalizeBaseUrl(baseUrl)}/models`);

    if (apiKey) {
      url.searchParams.set('key', apiKey);
    }

    const displayUrl = new URL(url.toString());

    if (apiKey) {
      displayUrl.searchParams.set('key', '***');
    }

    return {
      requestUrl: url.toString(),
      displayUrl: displayUrl.toString(),
      headers: {},
    };
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/u, '');
  }

  private formatProviderConnectionError(
    provider: ModelProvider,
    url: string,
    error: unknown,
  ): string {
    const message = error instanceof Error ? error.message : 'connection failed';

    if (provider.providerType !== ModelProviderType.OLLAMA) {
      return [
        message,
        `tested url: ${url}`,
        '请确认后端进程可以访问该地址；如果需要代理，必须为后端进程配置 HTTP_PROXY/HTTPS_PROXY 或在网关层接入代理 agent',
      ].join('; ');
    }

    return [
      message,
      `tested url: ${url}`,
      'Ollama 本机部署时通常使用 http://127.0.0.1:11434；只有后端运行在 Docker 容器内时才使用 http://host.docker.internal:11434',
    ].join('; ');
  }

  private toProviderListItem(provider: ModelProvider): ProviderListItem {
    return {
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKeyConfigured: Boolean(provider.apiKeyEncrypted),
      apiKeyMasked: this.maskEncryptedSecret(provider.apiKeyEncrypted),
      enabled: provider.enabled,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    };
  }

  private maskEncryptedSecret(value: string | null): string {
    if (!value) {
      return '';
    }

    try {
      return this.maskSecret(decryptSecret(value));
    } catch {
      return '********';
    }
  }

  private maskSecret(value: string): string {
    if (value.length <= 6) {
      return '*'.repeat(value.length);
    }

    return `${value.slice(0, 3)}*********${value.slice(-3)}`;
  }

  private toProviderDetail(
    provider: ModelProvider & { modelConfigs: ModelConfigListItem[] },
  ): ProviderDetail {
    return {
      ...this.toProviderListItem(provider),
      modelConfigs: provider.modelConfigs.map((config) => this.toModelConfigListItem(config)),
    };
  }

  private toModelConfigListItem(config: ModelConfigListItem): ModelConfigListItem {
    return {
      id: config.id,
      providerId: config.providerId,
      modelName: config.modelName,
      modelType: config.modelType,
      credentialName: config.credentialName,
      contextLength: config.contextLength,
      enabled: config.enabled,
      timeoutSeconds: config.timeoutSeconds,
      maxTokens: config.maxTokens,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private toModelConfigDetail(
    config: ModelConfigListItem & { provider: ModelProvider },
  ): ModelConfigDetail {
    return {
      ...this.toModelConfigListItem(config),
      provider: this.toProviderListItem(config.provider),
    };
  }
}
