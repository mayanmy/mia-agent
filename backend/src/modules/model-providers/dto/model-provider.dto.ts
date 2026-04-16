import { ModelConfigType, ModelProviderType } from '@prisma/client';

export type ProviderListItem = {
  id: string;
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
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
