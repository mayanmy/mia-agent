import {
  AgentVisionMode,
  ModelCapabilityType,
  ModelConfigType,
  ModelProviderType,
  ModelThinkingMode
} from "@prisma/client";

/** 模型供应商管理列表的安全摘要，不返回原始 API Key。 */
export type ProviderListItem = {
  /** 供应商配置 ID。 */
  id: string;
  /** 管理端展示名称。 */
  name: string;
  /** 决定具体 Client 协议实现的供应商类型。 */
  providerType: ModelProviderType;
  /** 供应商 API Base URL。 */
  baseUrl: string;
  /** 是否已经保存可用密钥。 */
  apiKeyConfigured: boolean;
  /** 仅用于管理端辨识的掩码值。 */
  apiKeyMasked: string;
  /** 是否允许新模型调用。 */
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** 供应商详情及其下属模型配置。 */
export type ProviderDetail = ProviderListItem & {
  /** 当前供应商下的全部模型配置。 */
  modelConfigs: ModelConfigListItem[];
};

/** 创建模型供应商的输入。 */
export type ProviderCreateDto = {
  name?: string;
  providerType?: ModelProviderType;
  baseUrl?: string;
  /** 原始 API Key，只允许写入且不得回显。 */
  apiKey?: string;
  enabled?: boolean;
};

/** 更新模型供应商的输入；未提供字段保持原值。 */
export type ProviderUpdateDto = {
  name?: string;
  providerType?: ModelProviderType;
  baseUrl?: string;
  /** 新原始 API Key；空值语义由 Service 明确处理。 */
  apiKey?: string;
  enabled?: boolean;
};

/** 供应商连接测试的诊断结果。 */
export type ProviderTestConnectionResult = {
  /** 测试是否成功。 */
  ok: boolean;
  /** 收到 HTTP 响应时的状态码。 */
  status: number | null;
  /** HTTP 状态文本或归一化错误摘要。 */
  statusText: string;
  /** 完整测试耗时毫秒数。 */
  latencyMs: number;
  /** 实际探测 URL，仅用于管理员排障。 */
  url?: string;
};

/** Mia 可配置的模型能力分类。 */
export type ModelCapability = "chat" | "embedding" | "rerank";

/** 指定模型能力探测结果。 */
export type ModelCapabilityCheckResult = {
  modelName: string;
  requestedType: ModelConfigType;
  supported: boolean;
  /** 是否由远程元数据或实际调用验证，而非仅按名称推断。 */
  verified: boolean;
  capabilities: ModelCapability[];
  message: string;
};

/** 从供应商远程模型目录归一化后的模型摘要。 */
export type ProviderRemoteModel = {
  modelName: string;
  suggestedType: ModelConfigType;
  capabilities: ModelCapability[];
  /** 供应商未提供上下文长度时为空。 */
  contextLength: number | null;
};

/** 模型配置管理列表项。 */
export type ModelConfigListItem = {
  id: string;
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  contextLength: number;
  /** Embedding 向量维度；非 Embedding 模型为空。 */
  embeddingDimension: number | null;
  enabled: boolean;
  timeoutSeconds: number;
  /** Chat 最大生成 token；null 表示沿用供应商默认值。 */
  maxTokens: number | null;
  /** Chat 模型思考模式；AUTO 表示沿用供应商默认行为。 */
  thinkingMode: ModelThinkingMode;
  /** 是否允许 Agent 显式覆盖思考模式。 */
  thinkingSupported: boolean;
  capabilities?: ModelCapabilityType[];
  createdAt: Date;
  updatedAt: Date;
};

/** Agent 表单使用的安全模型选项，不暴露供应商连接和凭据配置。 */
export type ModelConfigOption = {
  id: string;
  modelName: string;
  modelType: ModelConfigType;
  providerId: string;
  providerName: string;
  providerType: ModelProviderType;
  thinkingMode: ModelThinkingMode;
  thinkingSupported: boolean;
  isDefault: boolean;
  capabilities: ModelCapabilityType[];
};

export type ModelCapabilityItem = {
  type: ModelCapabilityType;
  enabled: boolean;
  options: Record<string, unknown> | null;
  verified: boolean;
  verifiedAt: Date | null;
};

export type ModelCapabilitiesResponse = {
  modelConfigId: string;
  capabilities: ModelCapabilityItem[];
};

export type ModelCapabilitiesUpdateDto = {
  capabilities?: Array<{
    type?: ModelCapabilityType;
    enabled?: boolean;
    options?: Record<string, unknown> | null;
  }>;
};

export type ResolveChatModelRequest = {
  primaryModelConfigId: string;
  requiredCapabilities: ModelCapabilityType[];
  policy: {
    visionMode: AgentVisionMode;
    visionModelConfigId: string | null;
  };
  requestId: string;
};

export type ModelRouteDecision = {
  selectedModelConfigId: string;
  selectedRole: "PRIMARY" | "SYSTEM_VISION" | "AGENT_VISION";
  requiredCapabilities: ModelCapabilityType[];
  reason: "PRIMARY_SUPPORTS_ALL" | "AGENT_VISION_SELECTED" | "SYSTEM_VISION_FALLBACK";
  fallbackUsed: boolean;
};

/** 模型配置详情及所属供应商安全摘要。 */
export type ModelConfigDetail = ModelConfigListItem & {
  provider: ProviderListItem;
};

/** 创建模型配置的输入。 */
export type ModelConfigCreateDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
  credentialName?: string;
  contextLength?: number;
  embeddingDimension?: number | null;
  enabled?: boolean;
  timeoutSeconds?: number;
  maxTokens?: number | null;
  thinkingMode?: ModelThinkingMode;
  thinkingSupported?: boolean;
};

/** 更新模型配置的输入；未提供字段保持原值。 */
export type ModelConfigUpdateDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
  credentialName?: string;
  contextLength?: number;
  embeddingDimension?: number | null;
  enabled?: boolean;
  timeoutSeconds?: number;
  maxTokens?: number | null;
  thinkingMode?: ModelThinkingMode;
  thinkingSupported?: boolean;
};

/** 发起模型能力检查的输入。 */
export type ModelCapabilityCheckDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
};

/** 系统级默认 Chat 与 Embedding 模型设置。 */
export type DefaultModelSettings = {
  /** 默认 Chat 模型配置 ID；尚未设置时为空。 */
  chatModelConfigId: string | null;
  /** 默认 Embedding 模型配置 ID；尚未设置时为空。 */
  embeddingModelConfigId: string | null;
  visionModelConfigId: string | null;
  chatModelConfig: ModelConfigListItem | null;
  embeddingModelConfig: ModelConfigListItem | null;
  visionModelConfig: ModelConfigListItem | null;
  updatedAt: Date | null;
};

/** 更新系统默认模型的输入；null 表示显式清除。 */
export type DefaultModelSettingsUpdateDto = {
  chatModelConfigId?: string | null;
  embeddingModelConfigId?: string | null;
  visionModelConfigId?: string | null;
};

/** 供应商列表分页参数。 */
export type ProviderQueryDto = {
  page?: string;
  pageSize?: string;
};

/** 模型配置列表分页与归属筛选。 */
export type ModelConfigQueryDto = {
  page?: string;
  pageSize?: string;
  providerId?: string;
  modelType?: ModelConfigType;
};
