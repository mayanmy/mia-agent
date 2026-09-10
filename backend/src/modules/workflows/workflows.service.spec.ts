import * as assert from "node:assert/strict";
import { WorkflowStatus } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowAppsController } from "../workflow_runtime/workflow-apps.controller";
import { WorkflowGraph } from "./dto/workflow-graph.dto";
import { WorkflowsService } from "./workflows.service";

const now = new Date("2026-07-29T10:00:00.000Z");
const graph: WorkflowGraph = { schemaVersion: 1, nodes: [], edges: [] };
const unusedCompiler = { compile: async () => ({ valid: true, issues: [] }) };

export const tests = [
  {
    name: "WorkflowsController 使用项目空间管理员权限限制 Workflow 管理",
    run: () => {
      assert.deepEqual(Reflect.getMetadata("mia:roles", WorkflowsController), ["ADMIN", "USER"]);
      assert.deepEqual(Reflect.getMetadata("mia:workspace-roles", WorkflowsController), [
        "OWNER",
        "MANAGER"
      ]);
    }
  },
  {
    name: "WorkflowAppsController exposes published apps to administrators and members",
    run: () => {
      assert.deepEqual(Reflect.getMetadata("mia:roles", WorkflowAppsController), ["ADMIN", "USER"]);
    }
  },
  {
    name: "WorkflowsService creates a revisioned Workflow draft",
    run: async () => {
      let createdData: Record<string, unknown> | undefined;
      const prisma = {
        workflow: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdData = data;
            return {
              id: "workflow-1",
              name: data.name,
              description: data.description,
              status: WorkflowStatus.DRAFT,
              draftGraph: data.draftGraph,
              draftRevision: 1,
              publishedVersion: null,
              createdByUserId: data.createdByUserId,
              createdAt: now,
              updatedAt: now,
              _count: { versions: 0 }
            };
          }
        }
      };
      const result = await new WorkflowsService(
        prisma as never,
        unusedCompiler as never
      ).createWorkflow({ name: "  穿衣流程  ", graph }, "user-1");

      assert.equal(result.name, "穿衣流程");
      assert.equal(result.draftRevision, 1);
      assert.equal(result.versionCount, 0);
      assert.deepEqual(createdData?.draftGraph, graph);
      assert.equal(createdData?.workspaceId, "00000000-0000-4000-8000-000000000001");
      assert.equal(createdData?.createdByUserId, "user-1");
    }
  },
  {
    name: "WorkflowsService updates drafts with optimistic revision locking",
    run: async () => {
      let updateWhere: Record<string, unknown> | undefined;
      const prisma = {
        workflow: {
          updateMany: async ({ where }: { where: Record<string, unknown> }) => {
            updateWhere = where;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => ({ draftRevision: 4, updatedAt: now })
        }
      };
      const result = await new WorkflowsService(
        prisma as never,
        unusedCompiler as never
      ).updateDraft("workflow-1", {
        expectedRevision: 3,
        graph
      });

      assert.deepEqual(updateWhere, {
        id: "workflow-1",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        deletedAt: null,
        draftRevision: 3
      });
      assert.equal(result.draftRevision, 4);
    }
  },
  {
    name: "WorkflowsService rejects a stale draft revision",
    run: async () => {
      const prisma = {
        workflow: {
          updateMany: async () => ({ count: 0 }),
          findFirst: async () => ({ id: "workflow-1" })
        }
      };
      const service = new WorkflowsService(prisma as never, unusedCompiler as never);

      await assert.rejects(
        () => service.updateDraft("workflow-1", { expectedRevision: 2, graph }),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.workflow.revisionConflict);
          assert.equal(error.httpStatus, 409);
          return true;
        }
      );
    }
  },
  {
    name: "WorkflowsService exposes an immutable version while its Workflow remains published",
    run: async () => {
      const prisma = {
        workflowVersion: {
          findFirst: async () => ({
            id: "version-2",
            workflowId: "workflow-1",
            version: 2,
            graphSchemaVersion: 1,
            checksum: "checksum-2",
            compiledPlan: { startNodeId: "start" },
            workflow: { publishedVersion: 2 }
          })
        }
      };
      const result = await new WorkflowsService(
        prisma as never,
        unusedCompiler as never
      ).getPublishedRuntimeConfig("workflow-1", "version-2");

      assert.equal(result.workflowVersionId, "version-2");
      assert.deepEqual(result.compiledPlan, { startNodeId: "start" });
    }
  },
  {
    name: "WorkflowsService restores an Agent tool from its pinned historical version",
    run: async () => {
      const workflowId = "11111111-1111-4111-8111-111111111111";
      const versionId = "22222222-2222-4222-8222-222222222222";
      const prisma = {
        workflowVersion: {
          findMany: async () => [
            {
              id: versionId,
              workflowId,
              version: 1,
              graph: {
                schemaVersion: 1,
                nodes: [
                  {
                    id: "start",
                    type: "start",
                    name: "开始",
                    config: {
                      inputs: [
                        { name: "city", type: "string", required: true, description: "城市" }
                      ]
                    }
                  }
                ],
                edges: []
              },
              createdAt: now,
              workflow: { id: workflowId, name: "天气流程", description: "查询天气" }
            }
          ]
        }
      };
      const toolId = `workflow:${workflowId}:${versionId}`;
      const definitions = await new WorkflowsService(
        prisma as never,
        unusedCompiler as never
      ).getWorkflowToolDefinitions([toolId]);

      assert.equal(definitions[0]?.id, toolId);
      assert.deepEqual(definitions[0]?.inputSchema.required, ["city"]);
      assert.deepEqual(definitions[0]?.inputSchema.properties?.city, {
        type: "string",
        description: "城市"
      });
    }
  },
  {
    name: "WorkflowsService publishes a compiled immutable version transactionally",
    run: async () => {
      const executableGraph: WorkflowGraph = {
        schemaVersion: 1,
        nodes: [
          { id: "start", type: "start", name: "开始", config: { inputs: [] } },
          { id: "end", type: "end", name: "结束", config: { output: {} } }
        ],
        edges: [{ id: "edge-1", source: "start", target: "end" }]
      };
      let versionData: Record<string, unknown> | undefined;
      let publishWhere: Record<string, unknown> | undefined;
      const transaction = {
        workflow: {
          updateMany: async ({ where }: { where: Record<string, unknown> }) => {
            publishWhere = where;
            return { count: 1 };
          }
        },
        workflowVersion: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            versionData = data;
            return { id: "version-1", createdAt: now };
          }
        }
      };
      const prisma = {
        workflow: {
          findFirst: async () => ({
            draftGraph: executableGraph,
            draftRevision: 3,
            publishedVersion: null
          })
        },
        $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      };
      const compiler = {
        compile: async () => ({
          valid: true,
          issues: [],
          compiledPlan: { schemaVersion: 1, startNodeId: "start" },
          checksum: "compiled-checksum"
        })
      };

      const result = await new WorkflowsService(prisma as never, compiler as never).publishWorkflow(
        "workflow-1",
        { expectedRevision: 3, expectedChecksum: "compiled-checksum" },
        "user-1"
      );

      assert.equal(result.workflowVersionId, "version-1");
      assert.equal(result.version, 1);
      assert.equal(versionData?.checksum, "compiled-checksum");
      assert.deepEqual(versionData?.graph, executableGraph);
      assert.equal(publishWhere?.draftRevision, 3);
      assert.equal(publishWhere?.publishedVersion, null);
    }
  }
];
