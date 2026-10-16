import * as assert from "node:assert/strict";

import { buildBudgetedModelContext, estimateTextTokens } from "./context-budget";

export const tests = [
  {
    name: "ContextBudget trims a single oversized message without changing persisted input",
    run: () => {
      const original = "中".repeat(10_000);
      const result = buildBudgetedModelContext({
        systemPrompt: "system",
        history: [{ role: "user", content: original }],
        retrievalContext: null,
        currentMessage: { role: "user", content: "current" },
        contextWindowTokens: 20_000,
        outputReserveTokens: 1_000,
        maxMessageTokens: 512
      });
      assert.equal(original.length, 10_000);
      assert.ok(result.report.stageTwoTrimmed > 0);
      assert.ok(result.messages.some((message) => String(message.content).includes("已按上下文预算裁剪")));
    }
  },
  {
    name: "ContextBudget removes old history before relevant RAG and tool results",
    run: () => {
      const result = buildBudgetedModelContext({
        systemPrompt: "system",
        history: [
          { role: "user", content: "old ".repeat(800) },
          { role: "assistant", content: "old answer ".repeat(800) }
        ],
        retrievalContext: {
          query: "q",
          elapsedMs: 1,
          sources: [{ knowledgeBaseId: "k", documentId: "d", documentName: "doc", chunkId: "c", chunkIndex: 0, score: 0.99, content: "relevant" }]
        },
        toolMessages: [{ role: "tool", toolCallId: "t", content: "tool-result" }],
        currentMessage: { role: "user", content: "current-question" },
        contextWindowTokens: 2_048,
        outputReserveTokens: 0
      });
      const text = result.messages.map((message) => String(message.content)).join("\n");
      assert.ok(!text.includes("old answer"));
      assert.ok(text.includes("relevant"));
      assert.ok(text.includes("tool-result"));
      assert.ok(text.includes("current-question"));
    }
  },
  {
    name: "ContextBudget token estimator is conservative for Chinese text",
    run: () => assert.equal(estimateTextTokens("中文abcde"), 4)
  }
];
