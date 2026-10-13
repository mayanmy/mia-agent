import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AgentVisionMode,
  ModelCapabilityType,
  ModelConfigType,
  ModelProvider,
  ModelProviderType,
  ModelThinkingMode,
  Prisma
} from "@prisma/client";

import { decryptSecret, encryptSecret } from "../../core/crypto";
import { getWorkspaceId, requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse
} from "./dto/llm.dto";
import {
  DefaultModelSettings,
  DefaultModelSettingsUpdateDto,
  ModelCapability,
  ModelCapabilityCheckResult,
  ModelCapabilitiesResponse,
  ModelCapabilitiesUpdateDto,
  ModelConfigCreateDto,
  ModelConfigDetail,
  ModelConfigListItem,
  ModelConfigOption,
  ModelConfigQueryDto,
  ModelConfigUpdateDto,
  ModelRouteDecision,
  ProviderCreateDto,
  ProviderDetail,
  ProviderListItem,
  ProviderRemoteModel,
  ProviderQueryDto,
  ProviderTestConnectionResult,
  ProviderUpdateDto,
  ResolveChatModelRequest
} from "./dto/model-provider.dto";
import { ModelProvidersGateway } from "./gateway";

const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_CONTEXT_LENGTH = 4096;
const ANTHROPIC_VERSION = "2023-06-01";

type ProviderTestRequest = {
  requestUrl: string;
  displayUrl: string;
  headers: HeadersInit;
};

@Injectable()
export class ModelProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ModelProvidersGateway
  ) {}

  async listProviders(query: ProviderQueryDto): Promise<PageResult<ProviderListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.ModelProviderWhereInput = {
      workspaceId: requireWorkspaceId(),
      deletedAt: null
    };

    // 列表与总数共用同一事务快照，避免高频配置变更时分页元数据短暂不一致。
    const [list, total] = await this.prisma.$transaction([
      this.prisma.modelProvider.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.modelProvider.count({ where })
    ]);

    return createPageResult(
      list.map((provider) => this.toProviderListItem(provider)),
      total,
      page.page,
      page.pageSize
    );
  }

  async createProvider(payload: ProviderCreateDto): Promise<ProviderDetail> {
    const data = this.validateProviderCreate(payload);
    await this.ensureProviderNameAvailable(data.name);

    const provider = await this.prisma.modelProvider.create({
      data: {
        workspaceId: requireWorkspaceId(),
        name: data.name,
        providerType: data.providerType,
        baseUrl: data.baseUrl,
        apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey) : null,
        enabled: data.enabled
      },
      include: { modelConfigs: { where: { deletedAt: null } } }
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
      where: { id, workspaceId: requireWorkspaceId() },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.providerType ? { providerType: data.providerType } : {}),
        ...(data.baseUrl ? { baseUrl: data.baseUrl } : {}),
        ...(data.apiKey !== undefined
          ? { apiKeyEncrypted: data.apiKey ? encryptSecret(data.apiKey) : null }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {})
      },
      include: { modelConfigs: { where: { deletedAt: null } } }
    });

    return this.toProviderDetail(provider);
  }

  async deleteProvider(id: string): Promise<void> {
    await this.ensureProviderExists(id);

    const activeModelConfigCount = await this.prisma.modelConfig.count({
      where: {
        providerId: id,
        workspaceId: requireWorkspaceId(),
        deletedAt: null
      }
    });

    if (activeModelConfigCount > 0) {
      throw new AppError(
        ErrorCodes.provider.inUse,
        "provider has model configs and cannot be deleted",
        HttpStatus.CONFLICT
      );
    }

    await this.prisma.modelProvider.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data: { deletedAt: new Date(), enabled: false }
    });
  }

  async testProviderConnection(id: string): Promise<ProviderTestConnectionResult> {
    const provider = await this.ensureProviderExists(id);
    const startedAt = Date.now();
    const timeoutMs = 30_000;
    const testRequest = this.getProviderTestRequest(provider);

    try {
      const response = await fetch(testRequest.requestUrl, {
        method: "GET",
        headers: testRequest.headers,
        signal: AbortSignal.timeout(timeoutMs)
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        latencyMs: Date.now() - startedAt,
        url: testRequest.displayUrl
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        statusText: this.formatProviderConnectionError(provider, testRequest.displayUrl, error),
        latencyMs: Date.now() - startedAt,
        url: testRequest.displayUrl
      };
    }
  }

  async listProviderModels(id: string): Promise<ProviderRemoteModel[]> {
    const provider = await this.ensureProviderExists(id);

    if (provider.providerType === ModelProviderType.OLLAMA) {
      return this.listOllamaModels(provider);
    }

    if (provider.providerType === ModelProviderType.GEMINI) {
      return this.listGeminiModels(provider);
    }

    return this.listOpenAIStyleModels(provider);
  }

  async listModelConfigs(query: ModelConfigQueryDto): Promise<PageResult<ModelConfigListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.ModelConfigWhereInput = {
      workspaceId: requireWorkspaceId(),
      deletedAt: null,
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.modelType ? { modelType: query.modelType } : {})
    };

    // 列表与总数共用同一事务快照，保证模型配置分页口径一致。
    const [list, total] = await this.prisma.$transaction([
      this.prisma.modelConfig.findMany({
        where,
        include: { capabilities: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.modelConfig.count({ where })
    ]);

    return createPageResult(
      list.map((config) => this.toModelConfigListItem(config)),
      total,
      page.page,
      page.pageSize
    );
  }

  /** 仅返回 Agent 表单所需字段，避免成员读取供应商连接与凭据摘要。 */
  async listChatModelOptions(): Promise<ModelConfigOption[]> {
    const workspaceId = requireWorkspaceId();
    const [configs, settings] = await this.prisma.$transaction([
      this.prisma.modelConfig.findMany({
        where: {
          workspaceId,
          modelType: ModelConfigType.CHAT,
          enabled: true,
          deletedAt: null,
          provider: { enabled: true, deletedAt: null }
        },
        include: { provider: true, capabilities: true },
        orderBy: [{ provider: { name: "asc" } }, { modelName: "asc" }]
      }),
      this.prisma.defaultModelSetting.findUnique({ where: { workspaceId } })
    ]);

    return configs.map((config) => ({
      id: config.id,
      modelName: config.modelName,
      modelType: config.modelType,
      providerId: config.providerId,
      providerName: config.provider.name,
      providerType: config.provider.providerType,
      thinkingMode: config.thinkingMode,
      thinkingSupported: config.thinkingSupported,
      isDefault: settings?.chatModelConfigId === config.id,
      capabilities: config.capabilities
        .filter((item) => item.enabled)
        .map((item) => item.capability)
    }));
  }

  async getModelCapabilities(id: string): Promise<ModelCapabilitiesResponse> {
    await this.findModelConfigDetail(id);
    const capabilities = await this.prisma.modelCapability.findMany({
      where: { modelConfigId: id },
      orderBy: { capability: "asc" }
    });
    return {
      modelConfigId: id,
      capabilities: capabilities.map((item) => ({
        type: item.capability,
        enabled: item.enabled,
        options: item.options as Record<string, unknown> | null,
        verified: item.verified,
        verifiedAt: item.verifiedAt
      }))
    };
  }

  async updateModelCapabilities(
    id: string,
    payload: ModelCapabilitiesUpdateDto
  ): Promise<ModelCapabilitiesResponse> {
    const config = await this.findModelConfigDetail(id);
    if (!Array.isArray(payload.capabilities)) {
      throw new AppError(ErrorCodes.common.badRequest, "capabilities must be an array");
    }
    const seen = new Set<ModelCapabilityType>();
    const rows = payload.capabilities.map((item) => {
      if (
        !item.type ||
        !Object.values(ModelCapabilityType).includes(item.type) ||
        seen.has(item.type)
      ) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          "capability type is invalid or duplicated"
        );
      }
      seen.add(item.type);
      return {
        type: item.type,
        enabled: item.enabled ?? true,
        options: item.options ?? null
      };
    });
    if (
      config.modelType === ModelConfigType.CHAT &&
      !rows.some((item) => item.type === ModelCapabilityType.TEXT_CHAT && item.enabled)
    ) {
      throw new AppError(ErrorCodes.common.badRequest, "chat model must keep TEXT_CHAT enabled");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.modelCapability.deleteMany({ where: { modelConfigId: id } });
      if (rows.length > 0) {
        await transaction.modelCapability.createMany({
          data: rows.map((item) => ({
            modelConfigId: id,
            capability: item.type,
            enabled: item.enabled,
            options: item.options as Prisma.InputJsonValue,
            verified: false
          }))
        });
      }
    });
    return this.getModelCapabilities(id);
  }

  /** 根据已声明能力和 Agent 策略选择实际 Chat 模型，不依赖模型名称猜测。 */
  async resolveChatModel(request: ResolveChatModelRequest): Promise<ModelRouteDecision> {
    const requiresVision = request.requiredCapabilities.includes(ModelCapabilityType.VISION_INPUT);
    const primary = await this.findRoutableChatModel(request.primaryModelConfigId);
    if (!requiresVision || this.supportsAll(primary, request.requiredCapabilities)) {
      return {
        selectedModelConfigId: primary.id,
        selectedRole: "PRIMARY",
        requiredCapabilities: request.requiredCapabilities,
        reason: "PRIMARY_SUPPORTS_ALL",
        fallbackUsed: false
      };
    }
    if (request.policy.visionMode === AgentVisionMode.DISABLED) {
      throw new AppError(ErrorCodes.chat.agentVisionDisabled, "当前 Agent 未启用图片处理");
    }
    if (request.policy.visionMode === AgentVisionMode.PRIMARY_ONLY) {
      throw new AppError(ErrorCodes.chat.primaryModelNoVision, "当前主模型不支持图片输入");
    }
    if (request.policy.visionMode === AgentVisionMode.DEDICATED) {
      if (!request.policy.visionModelConfigId) {
        throw new AppError(ErrorCodes.chat.visionModelDisabled, "Agent 尚未配置专用视觉模型");
      }
      const selected = await this.findRoutableChatModel(request.policy.visionModelConfigId);
      this.requireCapabilities(selected, request.requiredCapabilities);
      return {
        selectedModelConfigId: selected.id,
        selectedRole: "AGENT_VISION",
        requiredCapabilities: request.requiredCapabilities,
        reason: "AGENT_VISION_SELECTED",
        fallbackUsed: selected.id !== primary.id
      };
    }
    const defaults = await this.findDefaultModelSettings();
    if (!defaults?.visionModelConfigId) {
      throw new AppError(
        ErrorCodes.chat.defaultVisionModelNotConfigured,
        "系统尚未配置默认视觉模型"
      );
    }
    const selected = await this.findRoutableChatModel(defaults.visionModelConfigId);
    this.requireCapabilities(selected, request.requiredCapabilities);
    return {
      selectedModelConfigId: selected.id,
      selectedRole: "SYSTEM_VISION",
      requiredCapabilities: request.requiredCapabilities,
      reason: "SYSTEM_VISION_FALLBACK",
      fallbackUsed: selected.id !== primary.id
    };
  }

  async createModelConfig(payload: ModelConfigCreateDto): Promise<ModelConfigDetail> {
    const data = this.validateModelConfigCreate(payload);
    const provider = await this.ensureProviderExists(data.providerId);
    await this.ensureModelConfigAvailable(data.providerId, data.modelName, data.modelType);
    await this.ensureModelCapability(provider, data.modelName, data.modelType);

    const config = await this.prisma.modelConfig.create({
      data: {
        ...data,
        workspaceId: requireWorkspaceId(),
        capabilities: {
          create: {
            capability:
              data.modelType === ModelConfigType.CHAT
                ? ModelCapabilityType.TEXT_CHAT
                : ModelCapabilityType.EMBEDDING,
            enabled: true,
            verified: false
          }
        }
      },
      include: { provider: true }
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
    let provider = existing.provider;

    if (
      data.embeddingDimension === undefined &&
      (data.modelName !== undefined || data.modelType !== undefined)
    ) {
      data.embeddingDimension = this.normalizeEmbeddingDimension(undefined, modelName, modelType);
    }

    if (data.providerId) {
      provider = await this.ensureProviderExists(data.providerId);
    }

    if (
      providerId !== existing.providerId ||
      modelName !== existing.modelName ||
      modelType !== existing.modelType
    ) {
      await this.ensureModelConfigAvailable(providerId, modelName, modelType, id);
    }

    await this.ensureModelCapability(provider, modelName, modelType);

    const config = await this.prisma.modelConfig.update({
      where: { id, workspaceId: requireWorkspaceId() },
      data,
      include: { provider: true }
    });

    return this.toModelConfigDetail(config);
  }

  async deleteModelConfig(id: string): Promise<void> {
    await this.findModelConfigDetail(id);
    await this.ensureModelConfigNotInUse(id);

    // 清理默认模型引用与软删除配置必须原子提交，避免默认设置指向已删除模型。
    await this.prisma.$transaction([
      this.prisma.defaultModelSetting.updateMany({
        where: { workspaceId: requireWorkspaceId(), chatModelConfigId: id },
        data: { chatModelConfigId: null }
      }),
      this.prisma.defaultModelSetting.updateMany({
        where: { workspaceId: requireWorkspaceId(), embeddingModelConfigId: id },
        data: { embeddingModelConfigId: null }
      }),
      this.prisma.defaultModelSetting.updateMany({
        where: { workspaceId: requireWorkspaceId(), visionModelConfigId: id },
        data: { visionModelConfigId: null }
      }),
      this.prisma.modelConfig.update({
        where: { id, workspaceId: requireWorkspaceId() },
        data: { deletedAt: new Date(), enabled: false }
      })
    ]);
  }

  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.gateway.createChatCompletion(request);
  }

  async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.gateway.createEmbedding(request);
  }

  streamChatCompletion(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    return this.gateway.streamChatCompletion(request);
  }

  async checkModelCapability(
    providerId: unknown,
    modelName: unknown,
    modelType: unknown
  ): Promise<ModelCapabilityCheckResult> {
    const provider = await this.ensureProviderExists(
      this.requireNonEmptyString(providerId, "providerId")
    );

    return this.resolveModelCapability(
      provider,
      this.requireNonEmptyString(modelName, "modelName"),
      this.requireModelType(modelType)
    );
  }

  async getDefaultModelSettings(): Promise<DefaultModelSettings> {
    const settings = await this.findDefaultModelSettings();
    return this.toDefaultModelSettings(settings);
  }

  async getDefaultChatModelConfigId(): Promise<string | null> {
    const settings = await this.findDefaultModelSettings();
    return settings?.chatModelConfigId ?? null;
  }

  async ensureEnabledModelConfig(id: string, modelType: ModelConfigType): Promise<void> {
    const config = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        modelType,
        enabled: true,
        deletedAt: null,
        provider: {
          enabled: true,
          deletedAt: null
        }
      },
      select: {
        id: true
      }
    });

    if (!config) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        "model config not found or unavailable",
        HttpStatus.NOT_FOUND
      );
    }
  }

  async ensureVisionModelConfig(id: string): Promise<void> {
    const model = await this.findRoutableChatModel(id);
    this.requireCapabilities(model, [
      ModelCapabilityType.TEXT_CHAT,
      ModelCapabilityType.VISION_INPUT
    ]);
  }

  async getEmbeddingModelDimension(id: string): Promise<number> {
    const config = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        modelType: ModelConfigType.EMBEDDING,
        enabled: true,
        deletedAt: null,
        provider: {
          enabled: true,
          deletedAt: null
        }
      },
      select: {
        modelName: true,
        embeddingDimension: true
      }
    });

    if (!config) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        "model config not found or unavailable",
        HttpStatus.NOT_FOUND
      );
    }

    if (config.embeddingDimension) {
      return config.embeddingDimension;
    }

    // 维度不能只依赖模型名推断。OpenAI-compatible 场景下模型名称经常是自定义的，
    // 因此缺少显式配置时，使用一次真实 Embedding 调用探测维度并回写，后续知识库创建会稳定复用。
    const dimension = await this.detectEmbeddingModelDimension(id);
    await this.updateDetectedEmbeddingDimension(id, dimension);

    return dimension;
  }

  async updateDetectedEmbeddingDimension(id: string, dimension: number): Promise<void> {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 100_000) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "embeddingDimension must be a positive integer"
      );
    }

    await this.prisma.modelConfig.updateMany({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        modelType: ModelConfigType.EMBEDDING,
        deletedAt: null
      },
      data: {
        embeddingDimension: dimension
      }
    });
  }

  async updateDefaultModelSettings(
    payload: DefaultModelSettingsUpdateDto
  ): Promise<DefaultModelSettings> {
    const existingSettings = await this.findDefaultModelSettings();
    const chatModelConfigId = this.normalizeNullableId(payload.chatModelConfigId);
    const embeddingModelConfigId = this.normalizeNullableId(payload.embeddingModelConfigId);
    const visionModelConfigId =
      payload.visionModelConfigId === undefined
        ? (existingSettings?.visionModelConfigId ?? null)
        : this.normalizeNullableId(payload.visionModelConfigId);

    if (chatModelConfigId) {
      await this.ensureDefaultModelConfig(chatModelConfigId, ModelConfigType.CHAT);
    }

    if (embeddingModelConfigId) {
      await this.ensureDefaultModelConfig(embeddingModelConfigId, ModelConfigType.EMBEDDING);
    }

    if (visionModelConfigId) {
      const visionModel = await this.findRoutableChatModel(visionModelConfigId);
      this.requireCapabilities(visionModel, [
        ModelCapabilityType.TEXT_CHAT,
        ModelCapabilityType.VISION_INPUT
      ]);
    }

    const workspaceId = requireWorkspaceId();
    const settings = await this.prisma.defaultModelSetting.upsert({
      where: { workspaceId },
      create: {
        id: workspaceId,
        workspaceId,
        chatModelConfigId,
        embeddingModelConfigId,
        visionModelConfigId
      },
      update: {
        chatModelConfigId,
        embeddingModelConfigId,
        visionModelConfigId
      },
      include: {
        chatModelConfig: true,
        embeddingModelConfig: true,
        visionModelConfig: true
      }
    });

    return this.toDefaultModelSettings(settings);
  }

  private validateProviderCreate(payload: ProviderCreateDto): Required<ProviderCreateDto> {
    return {
      name: this.requireNonEmptyString(payload.name, "name"),
      providerType: this.requireProviderType(payload.providerType),
      baseUrl: this.requireUrl(payload.baseUrl),
      apiKey: payload.apiKey ?? "",
      enabled: payload.enabled ?? true
    };
  }

  private validateProviderUpdate(payload: ProviderUpdateDto): ProviderUpdateDto {
    return {
      ...(payload.name !== undefined
        ? { name: this.requireNonEmptyString(payload.name, "name") }
        : {}),
      ...(payload.providerType !== undefined
        ? { providerType: this.requireProviderType(payload.providerType) }
        : {}),
      ...(payload.baseUrl !== undefined ? { baseUrl: this.requireUrl(payload.baseUrl) } : {}),
      ...(payload.apiKey !== undefined ? { apiKey: payload.apiKey } : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {})
    };
  }

  private validateModelConfigCreate(payload: ModelConfigCreateDto): Required<ModelConfigCreateDto> {
    const modelName = this.requireNonEmptyString(payload.modelName, "modelName");
    const modelType = this.requireModelType(payload.modelType);

    return {
      providerId: this.requireNonEmptyString(payload.providerId, "providerId"),
      modelName,
      modelType,
      credentialName: this.normalizeOptionalString(payload.credentialName),
      contextLength: this.normalizeContextLength(payload.contextLength),
      embeddingDimension: this.normalizeEmbeddingDimension(
        payload.embeddingDimension,
        modelName,
        modelType
      ),
      enabled: payload.enabled ?? true,
      timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds),
      maxTokens: this.normalizeMaxTokens(payload.maxTokens),
      thinkingMode: payload.thinkingSupported
        ? this.requireThinkingMode(payload.thinkingMode ?? ModelThinkingMode.AUTO)
        : ModelThinkingMode.AUTO,
      thinkingSupported: Boolean(payload.thinkingSupported)
    };
  }

  private validateModelConfigUpdate(payload: ModelConfigUpdateDto): ModelConfigUpdateDto {
    const modelName =
      payload.modelName !== undefined
        ? this.requireNonEmptyString(payload.modelName, "modelName")
        : undefined;
    const modelType =
      payload.modelType !== undefined ? this.requireModelType(payload.modelType) : undefined;

    return {
      ...(payload.providerId !== undefined
        ? { providerId: this.requireNonEmptyString(payload.providerId, "providerId") }
        : {}),
      ...(modelName !== undefined ? { modelName } : {}),
      ...(modelType !== undefined ? { modelType } : {}),
      ...(payload.credentialName !== undefined
        ? { credentialName: this.normalizeOptionalString(payload.credentialName) }
        : {}),
      ...(payload.contextLength !== undefined
        ? { contextLength: this.normalizeContextLength(payload.contextLength) }
        : {}),
      ...(payload.embeddingDimension !== undefined
        ? {
            embeddingDimension: this.normalizeEmbeddingDimension(
              payload.embeddingDimension,
              modelName,
              modelType
            )
          }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
      ...(payload.timeoutSeconds !== undefined
        ? { timeoutSeconds: this.normalizeTimeout(payload.timeoutSeconds) }
        : {}),
      ...(payload.maxTokens !== undefined
        ? { maxTokens: this.normalizeMaxTokens(payload.maxTokens) }
        : {}),
      ...(payload.thinkingSupported === false
        ? { thinkingMode: ModelThinkingMode.AUTO }
        : payload.thinkingMode !== undefined
          ? { thinkingMode: this.requireThinkingMode(payload.thinkingMode) }
          : {}),
      ...(payload.thinkingSupported !== undefined
        ? { thinkingSupported: Boolean(payload.thinkingSupported) }
        : {})
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalString(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "credentialName must be a string");
    }

    return value.trim();
  }

  private normalizeNullableId(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.requireNonEmptyString(value, "modelConfigId");
  }

  private requireUrl(value: unknown): string {
    const url = this.requireNonEmptyString(value, "baseUrl");

    try {
      return new URL(url).toString().replace(/\/$/u, "");
    } catch {
      throw new AppError(ErrorCodes.common.badRequest, "baseUrl must be a valid URL");
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

    throw new AppError(ErrorCodes.common.badRequest, "providerType is invalid");
  }

  private requireModelType(value: unknown): ModelConfigType {
    if (value === ModelConfigType.CHAT || value === ModelConfigType.EMBEDDING) {
      return value;
    }

    throw new AppError(ErrorCodes.common.badRequest, "modelType is invalid");
  }

  private requireThinkingMode(value: unknown): ModelThinkingMode {
    if (
      value === ModelThinkingMode.AUTO ||
      value === ModelThinkingMode.ENABLED ||
      value === ModelThinkingMode.DISABLED
    ) {
      return value;
    }

    throw new AppError(ErrorCodes.common.badRequest, "thinkingMode is invalid");
  }

  private normalizeTimeout(value: unknown): number {
    if (value === undefined || value === null) {
      return DEFAULT_TIMEOUT_SECONDS;
    }

    const timeout = Number(value);

    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "timeoutSeconds must be an integer between 1 and 300"
      );
    }

    return timeout;
  }

  private normalizeMaxTokens(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const maxTokens = Number(value);

    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AppError(ErrorCodes.common.badRequest, "maxTokens must be a positive integer");
    }

    return maxTokens;
  }

  private normalizeContextLength(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_CONTEXT_LENGTH;
    }

    const contextLength = Number(value);

    if (!Number.isInteger(contextLength) || contextLength < 1 || contextLength > 1_000_000) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "contextLength must be an integer between 1 and 1000000"
      );
    }

    return contextLength;
  }

  private normalizeEmbeddingDimension(
    value: unknown,
    modelName: string | undefined,
    modelType: ModelConfigType | undefined
  ): number | null {
    if (modelType !== ModelConfigType.EMBEDDING) {
      return null;
    }

    if (value === undefined || value === null || value === "") {
      return null;
    }

    const dimension = Number(value);

    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 100_000) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "embeddingDimension must be a positive integer"
      );
    }

    return dimension;
  }

  private async detectEmbeddingModelDimension(modelConfigId: string): Promise<number> {
    try {
      const response = await this.createEmbedding({
        modelConfigId,
        input: "Mia embedding dimension probe"
      });
      const embedding = response.embeddings[0];

      if (!embedding) {
        throw new Error("embedding response is empty");
      }

      return embedding.length;
    } catch (error) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        `无法探测 Embedding 向量维度：${error instanceof Error ? error.message : String(error)}`,
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private async ensureProviderExists(id: string): Promise<ModelProvider> {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { id, workspaceId: requireWorkspaceId(), deletedAt: null }
    });

    if (!provider) {
      throw new AppError(ErrorCodes.provider.notFound, "provider not found", HttpStatus.NOT_FOUND);
    }

    return provider;
  }

  private async ensureProviderNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.modelProvider.findFirst({
      where: {
        workspaceId: requireWorkspaceId(),
        name,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.provider.nameExists,
        "provider name already exists",
        HttpStatus.CONFLICT
      );
    }
  }

  private async findProviderDetail(id: string) {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { id, workspaceId: requireWorkspaceId(), deletedAt: null },
      include: {
        modelConfigs: { where: { workspaceId: requireWorkspaceId(), deletedAt: null } }
      }
    });

    if (!provider) {
      throw new AppError(ErrorCodes.provider.notFound, "provider not found", HttpStatus.NOT_FOUND);
    }

    return provider;
  }

  private async ensureModelConfigAvailable(
    providerId: string,
    modelName: string,
    modelType: ModelConfigType,
    excludeId?: string
  ): Promise<void> {
    const existing = await this.prisma.modelConfig.findFirst({
      where: {
        workspaceId: requireWorkspaceId(),
        providerId,
        modelName,
        modelType,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.provider.modelConfigExists,
        "model config already exists",
        HttpStatus.CONFLICT
      );
    }
  }

  private async listOllamaModels(provider: ModelProvider): Promise<ProviderRemoteModel[]> {
    const url = `${this.getOllamaServerBaseUrl(provider.baseUrl)}/api/tags`;
    const response = await this.fetchProviderModels(provider, url, {
      headers: provider.apiKeyEncrypted
        ? { authorization: `Bearer ${decryptSecret(provider.apiKeyEncrypted)}` }
        : {}
    });
    const data = (await response.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        capabilities?: string[];
        details?: { context_length?: number };
      }>;
    };

    return this.sortRemoteModels(
      (data.models ?? [])
        .map((model) => {
          const modelName = model.name ?? model.model ?? "";
          const capabilities = this.normalizeOllamaCapabilities(model.capabilities ?? []);

          return this.toRemoteModel(
            modelName,
            capabilities.length > 0
              ? capabilities
              : this.inferModelCapabilities(provider.providerType, modelName),
            model.details?.context_length ?? null
          );
        })
        .filter((model) => model.modelName)
    );
  }

  private async listOpenAIStyleModels(provider: ModelProvider): Promise<ProviderRemoteModel[]> {
    const testRequest = this.getProviderTestRequest(provider);
    const response = await this.fetchProviderModels(provider, testRequest.requestUrl, {
      headers: testRequest.headers
    });
    const data = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    return this.sortRemoteModels(
      (data.data ?? [])
        .map((model) => {
          const modelName = model.id ?? "";
          return this.toRemoteModel(
            modelName,
            this.inferModelCapabilities(provider.providerType, modelName),
            null
          );
        })
        .filter((model) => model.modelName)
    );
  }

  private async listGeminiModels(provider: ModelProvider): Promise<ProviderRemoteModel[]> {
    const testRequest = this.getProviderTestRequest(provider);
    const response = await this.fetchProviderModels(provider, testRequest.requestUrl, {
      headers: testRequest.headers
    });
    const data = (await response.json()) as {
      models?: Array<{
        name?: string;
        inputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
    };

    return this.sortRemoteModels(
      (data.models ?? [])
        .map((model) => {
          const modelName = model.name?.replace(/^models\//u, "") ?? "";
          return this.toRemoteModel(
            modelName,
            this.normalizeGeminiCapabilities(model.supportedGenerationMethods ?? []),
            model.inputTokenLimit ?? null
          );
        })
        .filter((model) => model.modelName)
    );
  }

  private async fetchProviderModels(
    provider: ModelProvider,
    url: string,
    init: RequestInit
  ): Promise<Response> {
    const response = await fetch(url, {
      method: "GET",
      ...init,
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        `sync provider models failed with ${response.status} ${response.statusText}`,
        HttpStatus.BAD_GATEWAY
      );
    }

    if (provider.providerType === ModelProviderType.GEMINI) {
      return response;
    }

    return response;
  }

  private toRemoteModel(
    modelName: string,
    capabilities: ModelCapability[],
    contextLength: number | null
  ): ProviderRemoteModel {
    return {
      modelName,
      capabilities,
      suggestedType: capabilities.includes("embedding")
        ? ModelConfigType.EMBEDDING
        : ModelConfigType.CHAT,
      contextLength
    };
  }

  private sortRemoteModels(models: ProviderRemoteModel[]): ProviderRemoteModel[] {
    const unique = new Map<string, ProviderRemoteModel>();

    for (const model of models) {
      unique.set(model.modelName, model);
    }

    return [...unique.values()].sort((left, right) =>
      left.modelName.localeCompare(right.modelName)
    );
  }

  private async ensureModelCapability(
    provider: ModelProvider,
    modelName: string,
    modelType: ModelConfigType
  ): Promise<void> {
    const result = await this.resolveModelCapability(provider, modelName, modelType);

    if (result.verified && !result.supported) {
      throw new AppError(
        ErrorCodes.provider.connectionFailed,
        result.message,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async resolveModelCapability(
    provider: ModelProvider,
    modelName: string,
    modelType: ModelConfigType
  ): Promise<ModelCapabilityCheckResult> {
    if (provider.providerType === ModelProviderType.OLLAMA) {
      return this.resolveOllamaModelCapability(provider, modelName, modelType);
    }

    const capabilities = this.inferModelCapabilities(provider.providerType, modelName);
    const supported = this.hasRequestedCapability(capabilities, modelType);

    return {
      modelName,
      requestedType: modelType,
      supported,
      verified: true,
      capabilities,
      message: supported
        ? "model capability matched"
        : `model ${modelName} does not support ${modelType}`
    };
  }

  private async resolveOllamaModelCapability(
    provider: ModelProvider,
    modelName: string,
    modelType: ModelConfigType
  ): Promise<ModelCapabilityCheckResult> {
    const url = `${this.getOllamaServerBaseUrl(provider.baseUrl)}/api/tags`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: provider.apiKeyEncrypted
          ? { authorization: `Bearer ${decryptSecret(provider.apiKeyEncrypted)}` }
          : {},
        signal: AbortSignal.timeout(10_000)
      });

      if (!response.ok) {
        return this.unverifiedCapabilityResult(
          modelName,
          modelType,
          `cannot verify model capability: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as {
        models?: Array<{ name?: string; model?: string; capabilities?: string[] }>;
      };
      const model = data.models?.find(
        (item) => item.name === modelName || item.model === modelName
      );

      if (!model) {
        return {
          modelName,
          requestedType: modelType,
          supported: false,
          verified: true,
          capabilities: [],
          message: `model ${modelName} not found in Ollama`
        };
      }

      const capabilities = this.normalizeOllamaCapabilities(model.capabilities ?? []);
      const supported = this.hasRequestedCapability(capabilities, modelType);

      return {
        modelName,
        requestedType: modelType,
        supported,
        verified: true,
        capabilities,
        message: supported
          ? "model capability matched"
          : `model ${modelName} does not support ${modelType}`
      };
    } catch (error) {
      return this.unverifiedCapabilityResult(
        modelName,
        modelType,
        error instanceof Error ? error.message : "cannot verify model capability"
      );
    }
  }

  private unverifiedCapabilityResult(
    modelName: string,
    modelType: ModelConfigType,
    message: string
  ): ModelCapabilityCheckResult {
    return {
      modelName,
      requestedType: modelType,
      supported: true,
      verified: false,
      capabilities: [],
      message
    };
  }

  private inferModelCapabilities(
    providerType: ModelProviderType,
    modelName: string
  ): ModelCapability[] {
    if (providerType === ModelProviderType.ANTHROPIC || providerType === ModelProviderType.GEMINI) {
      return ["chat"];
    }

    const normalizedName = modelName.toLowerCase();

    if (
      normalizedName.includes("embedding") ||
      normalizedName.includes("embed") ||
      normalizedName.includes("text-embedding")
    ) {
      return ["embedding"];
    }

    if (normalizedName.includes("rerank")) {
      return ["rerank"];
    }

    return ["chat"];
  }

  private normalizeOllamaCapabilities(capabilities: string[]): ModelCapability[] {
    const normalized = new Set<ModelCapability>();

    for (const capability of capabilities) {
      const value = capability.toLowerCase();

      if (value === "completion" || value === "chat") {
        normalized.add("chat");
      }

      if (value === "embedding" || value === "embeddings") {
        normalized.add("embedding");
      }
    }

    return [...normalized];
  }

  private normalizeGeminiCapabilities(methods: string[]): ModelCapability[] {
    const normalized = new Set<ModelCapability>();

    for (const method of methods) {
      const value = method.toLowerCase();

      if (value === "generatecontent" || value === "streamgeneratecontent") {
        normalized.add("chat");
      }

      if (value === "embedcontent" || value === "batchembedcontents") {
        normalized.add("embedding");
      }
    }

    return [...normalized];
  }

  private hasRequestedCapability(
    capabilities: ModelCapability[],
    modelType: ModelConfigType
  ): boolean {
    if (modelType === ModelConfigType.CHAT) {
      return capabilities.includes("chat");
    }

    if (modelType === ModelConfigType.EMBEDDING) {
      return capabilities.includes("embedding");
    }

    return false;
  }

  private async findModelConfigDetail(id: string) {
    const config = await this.prisma.modelConfig.findFirst({
      where: { id, workspaceId: requireWorkspaceId(), deletedAt: null },
      include: { provider: true }
    });

    if (!config || config.provider.deletedAt) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        "model config not found",
        HttpStatus.NOT_FOUND
      );
    }

    return config;
  }

  private async findDefaultModelSettings() {
    return this.prisma.defaultModelSetting.findUnique({
      where: { workspaceId: requireWorkspaceId() },
      include: {
        chatModelConfig: true,
        embeddingModelConfig: true,
        visionModelConfig: true
      }
    });
  }

  private async findRoutableChatModel(id: string) {
    const config = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        modelType: ModelConfigType.CHAT,
        enabled: true,
        deletedAt: null,
        provider: { enabled: true, deletedAt: null }
      },
      include: { capabilities: true }
    });
    if (!config) {
      throw new AppError(
        ErrorCodes.chat.visionModelDisabled,
        "配置的视觉模型已停用或不可用",
        HttpStatus.BAD_REQUEST
      );
    }
    return config;
  }

  private supportsAll(
    model: { capabilities: Array<{ capability: ModelCapabilityType; enabled: boolean }> },
    required: ModelCapabilityType[]
  ): boolean {
    const enabled = new Set(
      model.capabilities.filter((item) => item.enabled).map((item) => item.capability)
    );
    return required.every((capability) => enabled.has(capability));
  }

  private requireCapabilities(
    model: { capabilities: Array<{ capability: ModelCapabilityType; enabled: boolean }> },
    required: ModelCapabilityType[]
  ): void {
    if (!this.supportsAll(model, required)) {
      throw new AppError(
        ErrorCodes.chat.modelCapabilityMismatch,
        "模型声明能力与本次输入要求不匹配",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async ensureDefaultModelConfig(id: string, modelType: ModelConfigType): Promise<void> {
    const modelConfig = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        workspaceId: requireWorkspaceId(),
        modelType,
        enabled: true,
        deletedAt: null,
        provider: {
          enabled: true,
          deletedAt: null
        }
      }
    });

    if (!modelConfig) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        `${modelType} default model must reference an enabled ${modelType} model config`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private async ensureModelConfigNotInUse(id: string): Promise<void> {
    const [agent, visionAgent, knowledgeBase] = await Promise.all([
      this.prisma.agent.findFirst({
        where: {
          workspaceId: requireWorkspaceId(),
          modelConfigId: id,
          deletedAt: null
        },
        select: {
          name: true
        }
      }),
      this.prisma.agent.findFirst({
        where: {
          workspaceId: requireWorkspaceId(),
          visionModelConfigId: id,
          deletedAt: null
        },
        select: { name: true }
      }),
      this.prisma.knowledgeBase.findFirst({
        where: {
          workspaceId: requireWorkspaceId(),
          embeddingModelConfigId: id,
          deletedAt: null
        },
        select: {
          name: true
        }
      })
    ]);

    if (agent) {
      throw new AppError(
        ErrorCodes.provider.inUse,
        `模型正在被 Agent「${agent.name}」使用，请先切换或删除该 Agent。`,
        HttpStatus.CONFLICT
      );
    }

    if (visionAgent) {
      throw new AppError(
        ErrorCodes.provider.inUse,
        `model config is used as the vision model by agent ${visionAgent.name}`,
        HttpStatus.CONFLICT
      );
    }

    if (knowledgeBase) {
      throw new AppError(
        ErrorCodes.provider.inUse,
        `模型正在被知识库「${knowledgeBase.name}」使用，请先为知识库切换 Embedding 模型或删除知识库。`,
        HttpStatus.CONFLICT
      );
    }
  }

  private getProviderTestRequest(provider: ModelProvider): ProviderTestRequest {
    const apiKey = provider.apiKeyEncrypted ? decryptSecret(provider.apiKeyEncrypted) : "";

    if (provider.providerType === ModelProviderType.OLLAMA) {
      const url = `${this.getOllamaServerBaseUrl(provider.baseUrl)}/api/tags`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
      };
    }

    if (provider.providerType === ModelProviderType.OPENAI_COMPATIBLE) {
      const url = `${this.normalizeBaseUrl(provider.baseUrl)}/models`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
      };
    }

    if (provider.providerType === ModelProviderType.ANTHROPIC) {
      const url = `${this.normalizeBaseUrl(provider.baseUrl)}/models`;

      return {
        requestUrl: url,
        displayUrl: url,
        headers: {
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          "anthropic-version": ANTHROPIC_VERSION
        }
      };
    }

    if (provider.providerType === ModelProviderType.GEMINI) {
      return this.getGeminiTestRequest(provider.baseUrl, apiKey);
    }

    return {
      requestUrl: provider.baseUrl,
      displayUrl: provider.baseUrl,
      headers: {}
    };
  }

  private getOllamaServerBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/v1$/u, "");
  }

  private getGeminiTestRequest(baseUrl: string, apiKey: string): ProviderTestRequest {
    const url = new URL(`${this.normalizeBaseUrl(baseUrl)}/models`);

    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }

    const displayUrl = new URL(url.toString());

    if (apiKey) {
      displayUrl.searchParams.set("key", "***");
    }

    return {
      requestUrl: url.toString(),
      displayUrl: displayUrl.toString(),
      headers: {}
    };
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/$/u, "");
  }

  private formatProviderConnectionError(
    provider: ModelProvider,
    url: string,
    error: unknown
  ): string {
    const message = error instanceof Error ? error.message : "connection failed";

    if (provider.providerType !== ModelProviderType.OLLAMA) {
      return [
        message,
        `tested url: ${url}`,
        "请确认后端进程可以访问该地址；如果需要代理，必须为后端进程配置 HTTP_PROXY/HTTPS_PROXY 或在网关层接入代理 agent"
      ].join("; ");
    }

    return [
      message,
      `tested url: ${url}`,
      "Ollama 本机部署时通常使用 http://127.0.0.1:11434；只有后端运行在 Docker 容器内时才使用 http://host.docker.internal:11434"
    ].join("; ");
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
      updatedAt: provider.updatedAt
    };
  }

  private maskEncryptedSecret(value: string | null): string {
    if (!value) {
      return "";
    }

    try {
      return this.maskSecret(decryptSecret(value));
    } catch {
      return "********";
    }
  }

  private maskSecret(value: string): string {
    if (value.length <= 6) {
      return "*".repeat(value.length);
    }

    return `${value.slice(0, 3)}*********${value.slice(-3)}`;
  }

  private toProviderDetail(
    provider: ModelProvider & { modelConfigs: ModelConfigListItem[] }
  ): ProviderDetail {
    return {
      ...this.toProviderListItem(provider),
      modelConfigs: provider.modelConfigs.map((config) => this.toModelConfigListItem(config))
    };
  }

  private toModelConfigListItem(
    config: Omit<ModelConfigListItem, "capabilities"> & {
      capabilities?: Array<
        ModelCapabilityType | { capability: ModelCapabilityType; enabled: boolean }
      >;
    }
  ): ModelConfigListItem {
    return {
      id: config.id,
      providerId: config.providerId,
      modelName: config.modelName,
      modelType: config.modelType,
      credentialName: config.credentialName,
      contextLength: config.contextLength,
      embeddingDimension: config.embeddingDimension,
      enabled: config.enabled,
      timeoutSeconds: config.timeoutSeconds,
      maxTokens: config.maxTokens,
      thinkingMode: config.thinkingMode,
      thinkingSupported: config.thinkingSupported,
      ...(config.capabilities
        ? {
            capabilities: config.capabilities.flatMap((item) =>
              typeof item === "string" ? [item] : item.enabled ? [item.capability] : []
            )
          }
        : {}),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    };
  }

  private toModelConfigDetail(
    config: ModelConfigListItem & { provider: ModelProvider }
  ): ModelConfigDetail {
    return {
      ...this.toModelConfigListItem(config),
      provider: this.toProviderListItem(config.provider)
    };
  }

  private toDefaultModelSettings(
    settings: Awaited<ReturnType<ModelProvidersService["findDefaultModelSettings"]>>
  ): DefaultModelSettings {
    return {
      chatModelConfigId: settings?.chatModelConfigId ?? null,
      embeddingModelConfigId: settings?.embeddingModelConfigId ?? null,
      visionModelConfigId: settings?.visionModelConfigId ?? null,
      chatModelConfig: settings?.chatModelConfig
        ? this.toModelConfigListItem(settings.chatModelConfig)
        : null,
      embeddingModelConfig: settings?.embeddingModelConfig
        ? this.toModelConfigListItem(settings.embeddingModelConfig)
        : null,
      visionModelConfig: settings?.visionModelConfig
        ? this.toModelConfigListItem(settings.visionModelConfig)
        : null,
      updatedAt: settings?.updatedAt ?? null
    };
  }
}
