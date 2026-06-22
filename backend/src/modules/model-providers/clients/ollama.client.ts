import { Injectable } from "@nestjs/common";

import { ProviderRuntimeConfig } from "../dto/llm.dto";
import { OpenAICompatibleClient } from "./openai-compatible.client";

@Injectable()
export class OllamaClient extends OpenAICompatibleClient {
  protected override getChatCompletionsUrl(baseUrl: string): string {
    return `${this.getOllamaOpenAIBaseUrl(baseUrl)}/chat/completions`;
  }

  protected override getEmbeddingsUrl(baseUrl: string): string {
    return `${this.getOllamaOpenAIBaseUrl(baseUrl)}/embeddings`;
  }

  private getOllamaOpenAIBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/$/u, "");

    if (normalized.endsWith("/v1")) {
      return normalized;
    }

    return `${normalized}/v1`;
  }

  protected override buildHeaders(config: ProviderRuntimeConfig): HeadersInit {
    return {
      "content-type": "application/json",
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    };
  }
}
