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
      const service = new AgentsService(
        prisma as never,
        modelProvidersService as never,
        toolsService as never
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
  }
];
