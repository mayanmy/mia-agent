import { ModelProviderType } from "@prisma/client";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[];
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
};

export type LLMToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
};

export type ChatCompletionRequest = {
  modelConfigId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none";
  signal?: AbortSignal;
};

export type EmbeddingRequest = {
  modelConfigId: string;
  input: string | string[];
  timeoutSeconds?: number;
  signal?: AbortSignal;
};

export type EmbeddingResponse = {
  embeddings: number[][];
  model: string;
  providerId: string;
  providerType: ModelProviderType;
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
};

export type ChatCompletionResponse = {
  content: string;
  model: string;
  providerId: string;
  providerType: ModelProviderType;
  toolCalls?: LLMToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type ChatStreamChunk =
  | {
      type: "token";
      content: string;
    }
  | {
      type: "tool_call";
      toolCall: LLMToolCall;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      errorMessage?: string;
    };

export type ProviderRuntimeConfig = {
  providerId: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  maxTokens: number | null;
};

export type ProviderChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none";
  signal: AbortSignal;
};

export type ProviderEmbeddingRequest = {
  input: string | string[];
  signal: AbortSignal;
};

export type TestChatCompletionDto = {
  messages?: ChatMessage[];
  prompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
};
