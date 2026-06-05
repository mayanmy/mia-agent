import type {
  ModelConfigListItem,
  ModelConfigPayload,
  ModelConfigType,
  ModelProviderType,
  ProviderListItem,
  ProviderPayload
} from "./api";
import type { ModelFormValues, ProviderFormValues, ProviderTemplate } from "./types";

export const providerTypes: ModelProviderType[] = [
  "OPENAI_COMPATIBLE",
  "OLLAMA",
  "ANTHROPIC",
  "GEMINI"
];
export const modelTypes: ModelConfigType[] = ["CHAT", "EMBEDDING"];

export const providerTypeLabels: Record<ModelProviderType, string> = {
  OPENAI_COMPATIBLE: "OpenAI 兼容",
  OLLAMA: "Ollama",
  ANTHROPIC: "Claude / Anthropic",
  GEMINI: "Gemini"
};

export const modelTypeLabels: Record<ModelConfigType, string> = {
  CHAT: "LLM",
  EMBEDDING: "TEXT EMBEDDING"
};

export const providerTemplates: ProviderTemplate[] = [
  {
    name: "Ollama",
    author: "local",
    downloads: "本地",
    description: "本地运行的 Ollama 模型服务，适合内网部署和离线使用。",
    providerType: "OLLAMA",
    baseUrl: "http://127.0.0.1:11434",
    logo: "O",
    accent: "#111827"
  },
  {
    name: "OpenAI",
    author: "langgenius",
    downloads: "687,536",
    description: "OpenAI 当前的语言、嵌入、内容审核与音频模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    logo: "O",
    accent: "#16c784"
  },
  {
    name: "Anthropic",
    author: "langgenius",
    downloads: "173,537",
    description: "Anthropic 的强大模型。",
    providerType: "ANTHROPIC",
    baseUrl: "https://api.anthropic.com/v1",
    logo: "AI",
    accent: "#d6a170"
  },
  {
    name: "Amazon Bedrock",
    author: "langgenius",
    downloads: "84,126",
    description: "The models of Amazon Bedrock",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://bedrock-runtime.example.com/v1",
    logo: "B",
    accent: "#2f9e83"
  },
  {
    name: "Gemini",
    author: "langgenius",
    downloads: "347,369",
    description: "谷歌提供的 Gemini 模型。",
    providerType: "GEMINI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    logo: "✦",
    accent: "#4f7cff"
  },
  {
    name: "深度求索",
    author: "langgenius",
    downloads: "1,250,314",
    description: "DeepSeek 提供的模型，例如 deepseek-chat、deepseek-reasoner 等。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.deepseek.com/v1",
    logo: "DS",
    accent: "#536dfe"
  },
  {
    name: "通义千问",
    author: "langgenius",
    downloads: "312,806",
    description: "阿里云提供的通义千问 Qwen 系列模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    logo: "Q",
    accent: "#6c5ce7"
  },
  {
    name: "Azure OpenAI",
    author: "langgenius",
    downloads: "204,153",
    description: "Azure OpenAI Service Model",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
    logo: "A",
    accent: "#1677ff"
  },
  {
    name: "Azure AI Studio",
    author: "langgenius",
    downloads: "33,367",
    description: "Azure AI Studio",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://YOUR_RESOURCE.services.ai.azure.com/models",
    logo: "AS",
    accent: "#3b82f6"
  },
  {
    name: "Cohere",
    author: "langgenius",
    downloads: "49,105",
    description: "Cohere",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.cohere.com/v1",
    logo: "C",
    accent: "#3b6b57"
  }
];

export const providerDefaults: ProviderFormValues = {
  name: "",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "",
  apiKey: "",
  enabled: true
};

export const modelDefaults: ModelFormValues = {
  providerId: "",
  modelName: "",
  modelType: "CHAT",
  credentialName: "",
  baseUrl: "",
  apiKey: "",
  contextLength: 4096,
  timeoutSeconds: 120,
  maxTokens: null,
  enabled: true
};

export function toProviderPayload(
  values: ProviderFormValues,
  keepEmptyApiKey = false
): ProviderPayload {
  const apiKey = values.apiKey?.trim();

  return {
    name: values.name.trim(),
    providerType: values.providerType,
    baseUrl: values.baseUrl.trim(),
    apiKey: keepEmptyApiKey && !apiKey ? undefined : (apiKey ?? ""),
    enabled: values.enabled
  };
}

export function toModelConfigPayload(values: ModelFormValues): ModelConfigPayload {
  return {
    providerId: values.providerId,
    modelName: values.modelName.trim(),
    modelType: values.modelType,
    credentialName: values.credentialName.trim(),
    contextLength: values.contextLength,
    timeoutSeconds: values.timeoutSeconds,
    maxTokens: values.maxTokens ?? null,
    enabled: values.enabled
  };
}

export function getProviderLogo(provider: ProviderListItem): string {
  const template = providerTemplates.find(
    (item) => item.name.toLowerCase() === provider.name.toLowerCase()
  );

  return template?.logo || provider.name.slice(0, 2).toUpperCase();
}

export function getProviderAccent(provider: ProviderListItem): string {
  const template = providerTemplates.find(
    (item) => item.name.toLowerCase() === provider.name.toLowerCase()
  );

  return template?.accent || "#2563eb";
}

export function buildModelSelectOptions(
  modelConfigs: ModelConfigListItem[],
  providers: ProviderListItem[],
  modelType: ModelConfigType
) {
  return providers
    .map((provider) => {
      const options = modelConfigs
        .filter(
          (model) =>
            model.providerId === provider.id && model.modelType === modelType && model.enabled
        )
        .map((model) => ({
          label: model.modelName,
          value: model.id
        }));

      return {
        label: provider.name,
        options
      };
    })
    .filter((group) => group.options.length > 0);
}
