import { ModelConfigType, ModelProviderType, ModelThinkingMode } from "./api";

/** 模型供应商表单字段；API Key 为只写字段。 */
export type ProviderFormValues = {
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  /** 新密钥；详情接口只返回掩码，不回填原值。 */
  apiKey?: string;
  enabled: boolean;
};

/** 模型配置表单字段，包含所属供应商的编辑辅助字段。 */
export type ModelFormValues = {
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  baseUrl: string;
  /** 仅新建/更换凭据时提交的原始密钥。 */
  apiKey?: string;
  contextLength: number;
  /** 仅 Embedding 模型要求填写。 */
  embeddingDimension?: number | null;
  timeoutSeconds: number;
  /** null 表示沿用供应商默认生成上限。 */
  maxTokens?: number | null;
  thinkingMode: ModelThinkingMode;
  thinkingSupported: boolean;
  visionInput: boolean;
  enabled: boolean;
};

/** 系统默认 Chat 与 Embedding 模型表单字段。 */
export type DefaultModelFormValues = {
  /** null 表示显式清除默认 Chat 模型。 */
  chatModelConfigId?: string | null;
  /** null 表示显式清除默认 Embedding 模型。 */
  embeddingModelConfigId?: string | null;
  /** null 表示显式清除默认视觉模型。 */
  visionModelConfigId?: string | null;
};

/** 前端内置供应商模板，仅用于预填表单而非运行时配置。 */
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
