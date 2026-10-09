import * as assert from "node:assert/strict";
import { ModelProviderType } from "@prisma/client";

import { ProviderRuntimeConfig } from "../dto/llm.dto";
import { OpenAICompatibleClient } from "./openai-compatible.client";

const runtimeConfig: ProviderRuntimeConfig = {
  providerId: "provider-1",
  providerType: ModelProviderType.OPENAI_COMPATIBLE,
  baseUrl: "https://example.com/v1",
  apiKey: "secret",
  modelName: "qwen3.7-flash",
  timeoutSeconds: 60,
  maxTokens: null
};

function streamResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

export const tests = [
  {
    name: "OpenAICompatibleClient separates reasoning_content from visible tokens",
    async run(): Promise<void> {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        streamResponse([
          { choices: [{ delta: { reasoning_content: "先判断原意" } }] },
          { choices: [{ delta: { content: "优化结果" } }] }
        ]);

      try {
        const chunks = [];
        for await (const chunk of new OpenAICompatibleClient().streamChatCompletion(runtimeConfig, {
          messages: [{ role: "user", content: "优化文本" }],
          signal: new AbortController().signal
        })) {
          chunks.push(chunk);
        }

        assert.deepEqual(chunks, [
          { type: "reasoning_token", content: "先判断原意" },
          { type: "token", content: "优化结果" },
          { type: "done" }
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },
  {
    name: "OpenAICompatibleClient keeps non-stream reasoning_content separate",
    async run(): Promise<void> {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            model: "qwen3.7-flash",
            choices: [{ message: { reasoning_content: "内部推理", content: "最终结果" } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );

      try {
        const response = await new OpenAICompatibleClient().createChatCompletion(runtimeConfig, {
          messages: [{ role: "user", content: "优化文本" }],
          signal: new AbortController().signal
        });

        assert.equal(response.content, "最终结果");
        assert.equal(response.reasoningContent, "内部推理");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
];
