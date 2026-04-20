import { ModelConfigType, ModelProviderType } from "@prisma/client";

export type ProviderListItem = {
  id: string;
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderDetail = ProviderListItem & {
  modelConfigs: ModelConfigListItem[];
};

export type ProviderCreateDto = {
  name?: string;
  providerType?: ModelProviderType;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
};

export type ProviderUpdateDto = {
  name?: string;
  providerType?: ModelProviderType;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
};

export type ProviderTestConnectionResult = {
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
  url?: string;
};

export type ModelCapability = "chat" | "embedding" | "rerank";

export type ModelCapabilityCheckResult = {
  modelName: string;
  requestedType: ModelConfigType;
  supported: boolean;
  verified: boolean;
  capabilities: ModelCapability[];
  message: string;
};

export type ModelConfigListItem = {
  id: string;
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  contextLength: number;
  enabled: boolean;
  timeoutSeconds: number;
  maxTokens: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelConfigDetail = ModelConfigListItem & {
  provider: ProviderListItem;
};

export type ModelConfigCreateDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
  credentialName?: string;
  contextLength?: number;
  enabled?: boolean;
  timeoutSeconds?: number;
  maxTokens?: number | null;
};

export type ModelConfigUpdateDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
  credentialName?: string;
  contextLength?: number;
  enabled?: boolean;
  timeoutSeconds?: number;
  maxTokens?: number | null;
};

export type ModelCapabilityCheckDto = {
  providerId?: string;
  modelName?: string;
  modelType?: ModelConfigType;
};

export type ProviderQueryDto = {
  page?: string;
  pageSize?: string;
};

export type ModelConfigQueryDto = {
  page?: string;
  pageSize?: string;
  providerId?: string;
  modelType?: ModelConfigType;
};
