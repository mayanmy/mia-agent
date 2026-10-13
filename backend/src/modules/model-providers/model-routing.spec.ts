import * as assert from "node:assert/strict";
import { AgentVisionMode, ModelCapabilityType } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { ModelProvidersService } from "./model-providers.service";

function createService(options: { primaryVision?: boolean; defaultVisionId?: string | null } = {}) {
  const prisma = {
    modelConfig: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        capabilities: [
          { capability: ModelCapabilityType.TEXT_CHAT, enabled: true },
          ...(where.id !== "primary" || options.primaryVision
            ? [{ capability: ModelCapabilityType.VISION_INPUT, enabled: true }]
            : [])
        ]
      })
    },
    defaultModelSetting: {
      findUnique: async () => ({ visionModelConfigId: options.defaultVisionId ?? null })
    }
  };
  return new ModelProvidersService(prisma as never, {} as never);
}

const request = {
  primaryModelConfigId: "primary",
  requiredCapabilities: [ModelCapabilityType.TEXT_CHAT, ModelCapabilityType.VISION_INPUT],
  policy: { visionMode: AgentVisionMode.AUTO, visionModelConfigId: null },
  requestId: "request-1"
};

export const tests = [
  {
    name: "Model routing keeps a vision-capable primary model",
    async run(): Promise<void> {
      const decision = await createService({ primaryVision: true }).resolveChatModel(request);
      assert.equal(decision.selectedModelConfigId, "primary");
      assert.equal(decision.fallbackUsed, false);
    }
  },
  {
    name: "Model routing falls back to the workspace default vision model",
    async run(): Promise<void> {
      const decision = await createService({ defaultVisionId: "vision-default" }).resolveChatModel(
        request
      );
      assert.equal(decision.selectedModelConfigId, "vision-default");
      assert.equal(decision.reason, "SYSTEM_VISION_FALLBACK");
    }
  },
  {
    name: "Model routing honors an Agent dedicated vision model",
    async run(): Promise<void> {
      const decision = await createService().resolveChatModel({
        ...request,
        policy: { visionMode: AgentVisionMode.DEDICATED, visionModelConfigId: "vision-agent" }
      });
      assert.equal(decision.selectedRole, "AGENT_VISION");
      assert.equal(decision.selectedModelConfigId, "vision-agent");
    }
  },
  {
    name: "Model routing rejects images when Agent vision is disabled",
    async run(): Promise<void> {
      await assert.rejects(
        createService().resolveChatModel({
          ...request,
          policy: { visionMode: AgentVisionMode.DISABLED, visionModelConfigId: null }
        }),
        (error: unknown) =>
          error instanceof AppError && error.code === ErrorCodes.chat.agentVisionDisabled
      );
    }
  }
];
