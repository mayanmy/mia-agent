import { request, type PageResult } from "../../shared/api/client";

/** 前端支持配置的模型供应商协议类型。 */
export type ModelProviderType = "OPENAI_COMPATIBLE" | "OLLAMA" | "ANTHROPIC" | "GEMINI";
/** 当前可创建的模型用途类型。 */
export type ModelConfigType = "CHAT" | "EMBEDDING";
export type ModelThinkingMode = "AUTO" | "ENABLED" | "DISABLED";

/** 供应商列表接口返回的安全摘要。 */
export type ProviderListItem = {
  id: string;
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  /** 是否已保存原始密钥。 */
  apiKeyConfigured: boolean;
  /** 仅供辨识的掩码密钥。 */
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 供应商详情及其下属模型配置。 */
export type ProviderDetail = ProviderListItem & {
  modelConfigs: ModelConfigListItem[];
};

/** 创建/更新供应商提交的字段。 */
export type ProviderPayload = {
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  /** 原始 API Key，只写且不会由详情接口回填。 */
  apiKey?: string;
  enabled: boolean;
};

/** 供应商连接测试结果。 */
export type ProviderTestConnectionResult = {
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
};

/** 模型配置列表项。 */
export type ModelConfigListItem = {
  id: string;
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  contextLength: number;
  /** 仅 Embedding 模型有值。 */
  embeddingDimension: number | null;
  enabled: boolean;
  timeoutSeconds: number;
  /** null 表示沿用供应商默认生成上限。 */
  maxTokens: number | null;
  thinkingMode: ModelThinkingMode;
  createdAt: string;
  updatedAt: string;
};

/** 模型配置详情及所属供应商安全摘要。 */
export type ModelConfigDetail = ModelConfigListItem & {
  provider: ProviderListItem;
};

/** 创建/更新模型配置提交的字段。 */
export type ModelConfigPayload = {
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  contextLength: number;
  embeddingDimension?: number | null;
  enabled: boolean;
  timeoutSeconds: number;
  maxTokens: number | null;
  thinkingMode: ModelThinkingMode;
};

/** 模型能力分类。 */
export type ModelCapability = "chat" | "embedding" | "rerank";

/** 指定模型能力探测结果。 */
export type ModelCapabilityCheckResult = {
  modelName: string;
  requestedType: ModelConfigType;
  supported: boolean;
  /** true 表示经过远程元数据或实际请求验证。 */
  verified: boolean;
  capabilities: ModelCapability[];
  message: string;
};

/** 供应商远程模型目录项。 */
export type ProviderRemoteModel = {
  modelName: string;
  suggestedType: ModelConfigType;
  capabilities: ModelCapability[];
  contextLength: number | null;
};

/** 系统默认 Chat 与 Embedding 模型设置。 */
export type DefaultModelSettings = {
  chatModelConfigId: string | null;
  embeddingModelConfigId: string | null;
  chatModelConfig: ModelConfigListItem | null;
  embeddingModelConfig: ModelConfigListItem | null;
  updatedAt: string | null;
};

/** Agent 表单可读取的安全模型选项。 */
export type ModelConfigOption = {
  id: string;
  modelName: string;
  modelType: "CHAT" | "EMBEDDING";
  providerId: string;
  providerName: string;
  providerType: ModelProviderType;
  isDefault: boolean;
};

/** 更新系统默认模型的请求；null 表示显式清除。 */
export type DefaultModelSettingsPayload = {
  chatModelConfigId: string | null;
  embeddingModelConfigId: string | null;
};

export function listProviders(page = 1, pageSize = 20): Promise<PageResult<ProviderListItem>> {
  return request<PageResult<ProviderListItem>>(
    `/api/v1/providers?page=${page}&pageSize=${pageSize}`
  );
}

export function createProvider(payload: ProviderPayload): Promise<ProviderDetail> {
  return request<ProviderDetail>("/api/v1/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateProvider(id: string, payload: ProviderPayload): Promise<ProviderDetail> {
  return request<ProviderDetail>(`/api/v1/providers/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteProvider(id: string): Promise<null> {
  return request<null>(`/api/v1/providers/${id}`, {
    method: "DELETE"
  });
}

export function testProviderConnection(id: string): Promise<ProviderTestConnectionResult> {
  return request<ProviderTestConnectionResult>(`/api/v1/providers/${id}/test-connection`, {
    method: "POST"
  });
}

export function listProviderModels(id: string): Promise<ProviderRemoteModel[]> {
  return request<ProviderRemoteModel[]>(`/api/v1/providers/${id}/models`);
}

export function listModelConfigs(
  page = 1,
  pageSize = 100,
  providerId?: string
): Promise<PageResult<ModelConfigListItem>> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  });

  if (providerId) {
    params.set("providerId", providerId);
  }

  return request<PageResult<ModelConfigListItem>>(`/api/v1/model-configs?${params.toString()}`);
}

export function listModelConfigOptions(): Promise<ModelConfigOption[]> {
  return request<ModelConfigOption[]>("/api/v1/model-configs/options");
}

export function createModelConfig(payload: ModelConfigPayload): Promise<ModelConfigDetail> {
  return request<ModelConfigDetail>("/api/v1/model-configs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateModelConfig(
  id: string,
  payload: ModelConfigPayload
): Promise<ModelConfigDetail> {
  return request<ModelConfigDetail>(`/api/v1/model-configs/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function checkModelCapability(
  payload: Pick<ModelConfigPayload, "providerId" | "modelName" | "modelType">
): Promise<ModelCapabilityCheckResult> {
  return request<ModelCapabilityCheckResult>("/api/v1/model-configs/check-capability", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteModelConfig(id: string): Promise<null> {
  return request<null>(`/api/v1/model-configs/${id}`, {
    method: "DELETE"
  });
}

export function getDefaultModelSettings(): Promise<DefaultModelSettings> {
  return request<DefaultModelSettings>("/api/v1/model-defaults");
}

export function updateDefaultModelSettings(
  payload: DefaultModelSettingsPayload
): Promise<DefaultModelSettings> {
  return request<DefaultModelSettings>("/api/v1/model-defaults", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
