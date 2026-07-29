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
    name: "Seed 豆包(火山方舟)",
    author: "mia",
    downloads: "162,473",
    description: "字节跳动Seed豆包大模型",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    logo: "S",
    accent: "#2563eb"
  },
  {
    name: "DeepSeek",
    author: "mia",
    downloads: "1,250,314",
    description: "DeepSeek 提供的模型，例如 deepseek-chat、deepseek-reasoner 等。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.deepseek.com/v1",
    logo: "DS",
    accent: "#165DFF"
  },
  {
    name: "通义千问",
    author: "mia",
    downloads: "312,806",
    description: "阿里云提供的通义千问 Qwen 系列模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    logo: "Q",
    accent: "#ff6a00"
  },
  {
    name: "Kimi 月之暗面",
    author: "mia",
    downloads: "198,742",
    description: "Moonshot Kimi，超长上下文",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.moonshot.cn/v1",
    logo: "K",
    accent: "#7b61ff"
  },
  {
    name: "智谱 GLM‑5",
    author: "mia",
    downloads: "176,351",
    description: "智谱AI GLM‑5 系列",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    logo: "G",
    accent: "#0084ff"
  },
  {
    name: "文心一言(千帆兼容)",
    author: "mia",
    downloads: "143,628",
    description: "百度文心一言ERNIE",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://qianfan.baidubce.com/v2",
    logo: "W",
    accent: "#2f80ed"
  },
  {
    name: "OpenAI",
    author: "mia",
    downloads: "687,536",
    description: "OpenAI 当前的语言、嵌入、内容审核与音频模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    logo: "O",
    accent: "#16c784"
  }
  // {
  //   name: "Anthropic",
  //   author: "mia",
  //   downloads: "173,537",
  //   description: "Anthropic 的强大模型。",
  //   providerType: "ANTHROPIC",
  //   baseUrl: "https://api.anthropic.com/v1",
  //   logo: "AI",
  //   accent: "#d6a170"
  // },
  // {
  //   name: "Amazon Bedrock",
  //   author: "mia",
  //   downloads: "84,126",
  //   description: "The models of Amazon Bedrock",
  //   providerType: "OPENAI_COMPATIBLE",
  //   baseUrl: "https://bedrock-runtime.example.com/v1",
  //   logo: "B",
  //   accent: "#2f9e83"
  // },
  // {
  //   name: "Gemini",
  //   author: "mia",
  //   downloads: "347,369",
  //   description: "谷歌提供的 Gemini 模型。",
  //   providerType: "GEMINI",
  //   baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  //   logo: "✦",
  //   accent: "#4f7cff"
  // },
  // {
  //   name: "Azure OpenAI",
  //   author: "mia",
  //   downloads: "204,153",
  //   description: "Azure OpenAI Service Model",
  //   providerType: "OPENAI_COMPATIBLE",
  //   baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
  //   logo: "A",
  //   accent: "#1677ff"
  // },
  // {
  //   name: "Azure AI Studio",
  //   author: "mia",
  //   downloads: "33,367",
  //   description: "Azure AI Studio",
  //   providerType: "OPENAI_COMPATIBLE",
  //   baseUrl: "https://YOUR_RESOURCE.services.ai.azure.com/models",
  //   logo: "AS",
  //   accent: "#3b82f6"
  // },
  // {
  //   name: "Cohere",
  //   author: "mia",
  //   downloads: "49,105",
  //   description: "Cohere",
  //   providerType: "OPENAI_COMPATIBLE",
  //   baseUrl: "https://api.cohere.com/v1",
  //   logo: "C",
  //   accent: "#3b6b57"
  // }
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
  embeddingDimension: null,
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
    embeddingDimension: values.modelType === "EMBEDDING" ? values.embeddingDimension : null,
    timeoutSeconds: values.timeoutSeconds,
    maxTokens: values.maxTokens ?? null,
    enabled: values.enabled
  };
}

export function inferEmbeddingDimension(modelName: string): number {
  const normalizedName = modelName.toLowerCase();

  if (normalizedName.includes("1024")) {
    return 1024;
  }

  if (normalizedName.includes("text-embedding-3-large") || normalizedName.includes("3072")) {
    return 3072;
  }

  return 1536;
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
