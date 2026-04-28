import { ModelProviderType } from '@prisma/client';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[];
};

export type ChatCompletionRequest = {
  modelConfigId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
  signal?: AbortSignal;
};

export type ChatCompletionResponse = {
  content: string;
  model: string;
  providerId: string;
  providerType: ModelProviderType;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type ChatStreamChunk = {
  type: 'token' | 'done' | 'error';
  content?: string;
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
  signal: AbortSignal;
};

export type TestChatCompletionDto = {
  messages?: ChatMessage[];
  prompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
};
