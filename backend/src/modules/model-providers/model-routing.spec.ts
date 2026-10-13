import * as assert from "node:assert/strict";
import { AgentVisionMode, ModelCapabilityType } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { ModelProvidersService } from "./model-providers.service";

function createService(
  options: {
    primaryVision?: boolean;
    defaultVisionId?: string | null;
    visionOptions?: Record<string, unknown>;
  } = {}
) {
  const prisma = {
    modelConfig: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        capabilities: [
          { capability: ModelCapabilityType.TEXT_CHAT, enabled: true },
          ...(where.id !== "primary" || options.primaryVision
            ? [
                {
                  capability: ModelCapabilityType.VISION_INPUT,
                  enabled: true,
                  options: options.visionOptions ?? null
                }
              ]
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
  },
  {
    name: "Vision input validation enforces declared MIME and count limits",
    async run(): Promise<void> {
      const service = createService({
        primaryVision: true,
        visionOptions: {
          maxImages: 1,
          supportedMimeTypes: ["image/png"],
          maxImageBytes: 10
        }
      });
      await service.validateVisionInput("primary", [
        { mimeType: "image/png", dataUrl: "data:image/png;base64,AQID" }
      ]);
      await assert.rejects(
        service.validateVisionInput("primary", [
          { mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,AQID" }
        ]),
        (error: unknown) =>
          error instanceof AppError && error.code === ErrorCodes.chat.unsupportedImageType
      );
    }
  },
  {
    name: "Capability verification persists verified state only after a real model call",
    async run(): Promise<void> {
      let modelCalled = false;
      let verifiedAt: Date | undefined;
      const capabilities = [
        {
          capability: ModelCapabilityType.TEXT_CHAT,
          enabled: true,
          options: null,
          verified: false,
          verifiedAt: null
        },
        {
          capability: ModelCapabilityType.VISION_INPUT,
          enabled: true,
          options: null,
          verified: false,
          verifiedAt: null
        }
      ];
      const prisma = {
        modelConfig: {
          findFirst: async () => ({
            id: "vision",
            modelType: "CHAT",
            timeoutSeconds: 60,
            provider: { deletedAt: null }
          })
        },
        modelCapability: {
          findMany: async () => capabilities,
          updateMany: async ({ data }: { data: { verifiedAt: Date } }) => {
            verifiedAt = data.verifiedAt;
            capabilities.forEach((item) => {
              item.verified = true;
              item.verifiedAt = data.verifiedAt as never;
            });
          }
        }
      };
      const gateway = {
        createChatCompletion: async () => {
          modelCalled = true;
          return { content: "OK" };
        }
      };
      const result = await new ModelProvidersService(
        prisma as never,
        gateway as never
      ).verifyModelCapabilities("vision");
      assert.equal(modelCalled, true);
      assert.ok(verifiedAt instanceof Date);
      assert.equal(
        result.capabilities.every((item) => item.verified),
        true
      );
    }
  }
];
