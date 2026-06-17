import * as assert from "node:assert/strict";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "./agents.service";

export const tests = [
  {
    name: "AgentsService.updateAgentTools rejects unknown tool IDs",
    run: async () => {
      const prisma = {
        agent: {
          findFirst: async () => ({ id: "agent-id" })
        },
        $transaction: async () => {
          throw new Error("transaction should not run for invalid tool IDs");
        }
      };
      const modelProvidersService = {};
      const toolsService = {
        getToolDefinitions: () => [
          {
            id: "calculator",
            name: "计算器",
            description: "执行基础数学计算。",
            enabled: true,
            inputSchema: {
              type: "object"
            }
          }
        ]
      };
      const knowledgeService = {};
      const service = new AgentsService(
        prisma as never,
        modelProvidersService as never,
        toolsService as never,
        knowledgeService as never
      );

      await assert.rejects(
        () =>
          service.updateAgentTools("agent-id", {
            toolIds: ["calculator", "missing_tool"]
          }),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agent.invalidTools);
          assert.equal(error.message, "unknown or disabled toolIds: missing_tool");
          return true;
        }
      );
    }
  },
  {
    name: "AgentsService.updateAgentKnowledgeBases rejects unknown knowledge base IDs",
    run: async () => {
      const prisma = {
        agent: {
          findFirst: async () => ({ id: "agent-id" })
        },
        $transaction: async () => {
          throw new Error("transaction should not run for invalid knowledge base IDs");
        }
      };
      const modelProvidersService = {};
      const toolsService = {};
      const knowledgeService = {
        ensureKnowledgeBaseIdsExist: async () => {
          throw new AppError(
            ErrorCodes.agent.invalidKnowledgeBases,
            "unknown or disabled knowledgeBaseIds: missing_kb"
          );
        }
      };
      const service = new AgentsService(
        prisma as never,
        modelProvidersService as never,
        toolsService as never,
        knowledgeService as never
      );

      await assert.rejects(
        () =>
          service.updateAgentKnowledgeBases("agent-id", {
            knowledgeBaseIds: ["knowledge_base_id", "missing_kb"]
          }),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agent.invalidKnowledgeBases);
          assert.equal(error.message, "unknown or disabled knowledgeBaseIds: missing_kb");
          return true;
        }
      );
    }
  }
];
