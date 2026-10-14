import * as assert from "node:assert/strict";
import { AgentExecutionMode, WorkspaceRole } from "@prisma/client";

import { runInWorkspaceContext } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "./agents.service";

export const tests = [
  {
    name: "AgentsService rejects a MEMBER updating another creator's Agent",
    run: async () => {
      const service = new AgentsService(
        {
          agent: {
            findFirst: async () => ({ id: "agent-id", createdByUserId: "other-user" })
          }
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );

      await assert.rejects(
        () =>
          runInWorkspaceContext(
            "00000000-0000-4000-8000-000000000001",
            { userId: "member-user", role: WorkspaceRole.MEMBER },
            () => service.updateAgent("agent-id", { name: "updated" })
          ),
        /只能管理自己创建的 Agent/u
      );
    }
  },
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
        knowledgeService as never,
        {} as never
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
        knowledgeService as never,
        {} as never
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
  },
  {
    name: "AgentsService binds only a Workflow version accepted by WorkflowsService",
    run: async () => {
      const writes: Array<Record<string, unknown>> = [];
      const prisma = {
        agent: {
          findFirst: async () => ({ id: "agent-id" }),
          update: async (request: Record<string, unknown>) => {
            writes.push(request);
            return {};
          }
        },
        agentWorkflow: {
          upsert: async (request: Record<string, unknown>) => {
            writes.push(request);
            return {};
          }
        },
        $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations)
      };
      let validatedBinding: { workflowId: string; versionId: string } | undefined;
      const workflowsService = {
        getPublishedRuntimeConfig: async (workflowId: string, versionId: string) => {
          validatedBinding = { workflowId, versionId };
          return {};
        }
      };
      const service = new AgentsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        workflowsService as never
      );

      const result = await service.updateAgentWorkflow("agent-id", {
        executionMode: AgentExecutionMode.WORKFLOW,
        workflowId: "workflow-1",
        workflowVersionId: "version-1"
      });

      assert.deepEqual(validatedBinding, {
        workflowId: "workflow-1",
        versionId: "version-1"
      });
      assert.equal(writes.length, 2);
      assert.deepEqual(result.workflow, {
        workflowId: "workflow-1",
        workflowVersionId: "version-1"
      });
    }
  },
  {
    name: "AgentsService refuses to publish a Workflow Agent without a version binding",
    run: async () => {
      const prisma = {
        agent: {
          findFirst: async () => ({ id: "agent-id" }),
          findUnique: async () => ({
            shareToken: null,
            executionMode: AgentExecutionMode.WORKFLOW,
            agentWorkflow: null
          })
        }
      };
      const service = new AgentsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      );

      await assert.rejects(
        () => service.publishAgent("agent-id"),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agent.invalidWorkflow);
          return true;
        }
      );
    }
  },
  {
    name: "AgentsService atomically replaces ordered Skill bindings",
    run: async () => {
      const writes: string[] = [];
      const prisma = {
        agent: { findFirst: async () => ({ id: "agent-id", createdByUserId: "owner" }) },
        agentSkill: {
          deleteMany: async () => {
            writes.push("delete");
          },
          createMany: async ({ data }: { data: Array<{ skillId: string; position: number }> }) => {
            writes.push(
              `create:${data.map((item) => `${item.skillId}@${item.position}`).join(",")}`
            );
          }
        },
        $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations)
      };
      const skills = { ensureBindableSkillIds: async () => undefined };
      const service = new AgentsService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        skills as never
      );
      const result = await service.updateAgentSkills("agent-id", {
        skills: [{ skillId: "skill-b" }, { skillId: "skill-a" }]
      });
      assert.deepEqual(writes, ["delete", "create:skill-b@0,skill-a@1"]);
      assert.deepEqual(
        result.skills.map((item) => item.skillId),
        ["skill-b", "skill-a"]
      );
    }
  }
];
