import * as assert from "node:assert/strict";
import { WorkflowStatus } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

const now = new Date("2026-07-29T10:00:00.000Z");
const graph = { schemaVersion: 1, nodes: [], edges: [] };

export const tests = [
  {
    name: "WorkflowsController restricts Workflow management to administrators",
    run: () => {
      assert.deepEqual(Reflect.getMetadata("mia:roles", WorkflowsController), ["ADMIN"]);
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
      const result = await new WorkflowsService(prisma as never).createWorkflow(
        { name: "  穿衣流程  ", graph },
        "user-1"
      );

      assert.equal(result.name, "穿衣流程");
      assert.equal(result.draftRevision, 1);
      assert.equal(result.versionCount, 0);
      assert.deepEqual(createdData?.draftGraph, graph);
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
      const result = await new WorkflowsService(prisma as never).updateDraft("workflow-1", {
        expectedRevision: 3,
        graph
      });

      assert.deepEqual(updateWhere, {
        id: "workflow-1",
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
      const service = new WorkflowsService(prisma as never);

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
    name: "WorkflowsService only exposes the current published version to runtimes",
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
      const result = await new WorkflowsService(prisma as never).getPublishedRuntimeConfig(
        "workflow-1",
        "version-2"
      );

      assert.equal(result.workflowVersionId, "version-2");
      assert.deepEqual(result.compiledPlan, { startNodeId: "start" });
    }
  }
];
