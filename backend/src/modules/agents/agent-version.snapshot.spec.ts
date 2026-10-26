import * as assert from "node:assert/strict";
import {
  AgentChatSessionMode,
  AgentExecutionMode,
  AgentRuntimeMode,
  AgentVisionMode,
  ModelProviderType,
  ModelThinkingMode
} from "@prisma/client";

import {
  canonicalizeAgentVersionValue,
  createAgentVersionSnapshot,
  hydrateAgentVersionSnapshot
} from "./agent-version.snapshot";
import type { AgentRuntimeConfig } from "./dto/agent.dto";

function runtime(): AgentRuntimeConfig {
  return {
    agentId: "agent-1",
    agentVersionId: null,
    configHash: "",
    runtimeMode: AgentRuntimeMode.DRAFT_PREVIEW,
    name: "客服",
    systemPrompt: "只回答订单问题",
    modelConfigId: "model-1",
    vision: { mode: AgentVisionMode.DISABLED, visionModelConfigId: null },
    modelName: "gpt-test",
    providerId: "provider-1",
    providerType: ModelProviderType.OPENAI_COMPATIBLE,
    baseUrl: "https://example.com/v1",
    temperature: 0.2,
    maxTokens: 1024,
    timeoutSeconds: 60,
    historyTurns: 6,
    chatSessionMode: AgentChatSessionMode.PERSISTENT,
    executionMode: AgentExecutionMode.AGENT_LOOP,
    workflow: null,
    generationParams: { top_p: 0.9 },
    thinkingMode: ModelThinkingMode.AUTO,
    knowledgeBaseIds: ["kb-1"],
    toolIds: ["calculator"],
    skills: [],
    unavailableSkillBindings: []
  };
}

export const tests = [
  {
    name: "AgentVersion snapshot hash ignores object key order but preserves array order",
    run: () => {
      assert.deepEqual(
        canonicalizeAgentVersionValue({ b: 2, a: { d: 4, c: 3 } }),
        canonicalizeAgentVersionValue({ a: { c: 3, d: 4 }, b: 2 })
      );
      const first = createAgentVersionSnapshot(runtime());
      const same = createAgentVersionSnapshot({ ...runtime(), generationParams: { top_p: 0.9 } });
      const reordered = createAgentVersionSnapshot({
        ...runtime(),
        knowledgeBaseIds: ["kb-2", "kb-1"]
      });
      assert.equal(first.configHash, same.configHash);
      assert.notEqual(first.configHash, reordered.configHash);
    }
  },
  {
    name: "AgentVersion snapshot hydrates an immutable runtime and detects corruption",
    run: () => {
      const created = createAgentVersionSnapshot(runtime());
      const hydrated = hydrateAgentVersionSnapshot(
        created.snapshot as never,
        created.configHash,
        AgentRuntimeMode.PUBLISHED
      );
      assert.equal(hydrated.systemPrompt, "只回答订单问题");
      assert.equal(hydrated.runtimeMode, AgentRuntimeMode.PUBLISHED);
      assert.throws(() =>
        hydrateAgentVersionSnapshot(
          { ...created.snapshot, schemaVersion: 2 } as never,
          created.configHash,
          AgentRuntimeMode.PUBLISHED
        )
      );
    }
  }
];
