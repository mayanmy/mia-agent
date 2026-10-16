import * as assert from "node:assert/strict";

import { AgentPromptBuilder } from "./prompt-builder";

export const tests = [
  {
    name: "AgentPromptBuilder renders query, retrieval instruction and tool rules",
    async run(): Promise<void> {
      const builder = new AgentPromptBuilder();
      const prompt = builder.buildSystemPrompt({
        systemPrompt: "请回答：{{ query }}",
        query: "Mia 是什么？",
        tools: [
          {
            name: "current_time",
            description: "获取当前时间",
            parameters: { type: "object" }
          }
        ],
        retrievalContext: {
          query: "Mia 是什么？",
          elapsedMs: 12,
          sources: [
            {
              knowledgeBaseId: "kb-1",
              documentId: "doc-1",
              documentName: "mia.md",
              chunkId: "chunk-1",
              chunkIndex: 0,
              score: 0.98,
              content: "Mia 是团队内部 Agent 工作台。"
            }
          ]
        }
      });

      assert.match(prompt, /请回答：Mia 是什么？/u);
      assert.match(prompt, /随后的知识库来源/u);
      assert.doesNotMatch(prompt, /Mia 是团队内部 Agent 工作台/u);
      assert.match(prompt, /current_time/u);
      assert.match(prompt, /不得把错误文案推断为被查询业务对象的真实状态/u);
      assert.doesNotMatch(prompt, /当前用户问题：/u);
    }
  },
  {
    name: "AgentPromptBuilder limits retrieval previews",
    async run(): Promise<void> {
      const preview = new AgentPromptBuilder().formatRetrievalSourcePreview(
        `  ${"a".repeat(600)}  `
      );

      assert.equal(preview.length, 503);
      assert.ok(preview.endsWith("..."));
    }
  },
  {
    name: "AgentPromptBuilder keeps Agent, Skill, Tool and RAG sections in stable order",
    async run(): Promise<void> {
      const prompt = new AgentPromptBuilder().buildSystemPrompt({
        systemPrompt: "Agent rules",
        query: "question",
        skillPrompt: "Skill rules",
        tools: [{ name: "lookup", description: "Lookup", parameters: {} }],
        retrievalContext: {
          query: "question",
          elapsedMs: 1,
          sources: [
            {
              knowledgeBaseId: "kb",
              documentId: "doc",
              documentName: "doc.md",
              chunkId: "chunk",
              chunkIndex: 0,
              score: 1,
              content: "RAG context"
            }
          ]
        }
      });
      assert.ok(prompt.indexOf("Agent rules") < prompt.indexOf("Skill rules"));
      assert.ok(prompt.indexOf("Skill rules") < prompt.indexOf("工具调用规则"));
      assert.ok(prompt.indexOf("工具调用规则") < prompt.indexOf("随后的知识库来源"));
    }
  }
];
