import { request, type PageResult } from "../../shared/api/client";

export type ModelProviderType = "OPENAI_COMPATIBLE" | "OLLAMA" | "ANTHROPIC" | "GEMINI";
export type ModelConfigType = "CHAT" | "EMBEDDING";

export type ProviderListItem = {
  id: string;
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProviderDetail = ProviderListItem & {
  modelConfigs: ModelConfigListItem[];
};

export type ProviderPayload = {
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
};

export type ProviderTestConnectionResult = {
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
};

export type ModelConfigListItem = {
  id: string;
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  enabled: boolean;
  timeoutSeconds: number;
  maxTokens: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ModelConfigDetail = ModelConfigListItem & {
  provider: ProviderListItem;
};

export type ModelConfigPayload = {
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  enabled: boolean;
  timeoutSeconds: number;
  maxTokens: number | null;
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

export function deleteModelConfig(id: string): Promise<null> {
  return request<null>(`/api/v1/model-configs/${id}`, {
    method: "DELETE"
  });
}

