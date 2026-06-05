import { ModelConfigType, ModelProviderType } from "./api";

export type ProviderFormValues = {
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
};

export type ModelFormValues = {
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  baseUrl: string;
  apiKey?: string;
  contextLength: number;
  timeoutSeconds: number;
  maxTokens?: number | null;
  enabled: boolean;
};

export type DefaultModelFormValues = {
  chatModelConfigId?: string | null;
  embeddingModelConfigId?: string | null;
};

export type ProviderTemplate = {
  name: string;
  author: string;
  downloads: string;
  description: string;
  providerType: ModelProviderType;
  baseUrl: string;
  logo: string;
  accent: string;
};
