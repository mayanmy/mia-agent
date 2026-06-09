import {
  ChatCompletionResponse,
  ChatStreamChunk,
  ProviderChatRequest,
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
}
