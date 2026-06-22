import {
  ChatCompletionResponse,
  EmbeddingResponse,
  ChatStreamChunk,
  ProviderChatRequest,
  ProviderEmbeddingRequest,
  ProviderRuntimeConfig
} from "../dto/llm.dto";

export interface ProviderClient {
  createChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest
  ): Promise<ChatCompletionResponse>;

  streamChatCompletion(
    config: ProviderRuntimeConfig,
    request: ProviderChatRequest
  ): AsyncIterable<ChatStreamChunk>;

  createEmbedding(
    config: ProviderRuntimeConfig,
    request: ProviderEmbeddingRequest
  ): Promise<EmbeddingResponse>;
}
