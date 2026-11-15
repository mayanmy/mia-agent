import * as assert from "node:assert/strict";
import { WorkflowScheduleStatus } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowSchedulesController } from "./workflow-schedules.controller";
import { WorkflowSchedulePlanner } from "./workflow-schedule-planner";
import { WorkflowSchedulesService } from "./workflow-schedules.service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-13T00:00:00.000Z");
const graph = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      type: "start",
      config: { inputs: [{ name: "city", type: "string", required: true }] }
    },
    { id: "end", type: "end", config: { output: {} } }
  ],
  edges: [{ id: "edge-1", source: "start", target: "end" }]
};

function scheduleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "schedule-1",
    workspaceId,
    workflowId: "workflow-1",
    workflowVersionId: "version-1",
    name: "工作日提醒",
    description: "",
    status: WorkflowScheduleStatus.PAUSED,
    cronExpression: "0 9 * * 1-5",
    timezone: "Asia/Shanghai",
    inputs: { city: "深圳" },
    misfirePolicy: "RUN_ONCE",
    concurrencyPolicy: "QUEUE",
    maxCatchUpRuns: 1,
    timeoutSeconds: 1800,
    nextRunAt: null,
    lastScheduledAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    createdByUserId: "user-1",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    workflowVersion: { version: 1 },
    ...overrides
  };
}

const tools = { getInteractiveApprovalToolIds: async () => [] };

export const tests = [
  {
    name: "WorkflowSchedulesController allows member reads and restricts schedule writes",
    run: () => {
      assert.equal(
        Reflect.getMetadata("mia:workspace-required", WorkflowSchedulesController),
        true
      );
      assert.deepEqual(
        Reflect.getMetadata(
          "mia:workspace-roles",
          WorkflowSchedulesController.prototype.createSchedule
        ),
        ["OWNER", "MANAGER"]
      );
      assert.equal(
        Reflect.getMetadata(
          "mia:workspace-roles",
          WorkflowSchedulesController.prototype.listSchedules
        ),
        undefined
      );
    }
  },
  {
    name: "WorkflowSchedulesService creates a pinned schedule paused by default",
    run: async () => {
      let createData: Record<string, unknown> | undefined;
      const prisma = {
        workflow: { findFirst: async () => ({ id: "workflow-1" }) },
        workflowVersion: {
          findFirst: async () => ({ id: "version-1", workflowId: "workflow-1", version: 1, graph })
        },
        workflowSchedule: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createData = data;
            return scheduleRecord({ ...data, workflowVersion: { version: 1 } });
          }
        }
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );
      const result = await service.createSchedule(
        "workflow-1",
        {
          name: " 工作日提醒 ",
          workflowVersionId: "version-1",
          cronExpression: "0 9 * * 1-5",
          timezone: "Asia/Shanghai",
          inputs: { city: "深圳" }
        },
        "user-1"
      );

      assert.equal(result.status, "PAUSED");
      assert.equal(result.workflowVersion, 1);
      assert.equal(createData?.workspaceId, workspaceId);
      assert.equal(createData?.nextRunAt, null);
    }
  },
  {
    name: "WorkflowSchedulesService validates Start inputs and interactive approval tools",
    run: async () => {
      const interactiveGraph = {
        ...graph,
        nodes: [...graph.nodes, { id: "tool", type: "tool", config: { toolId: "mcp_ticket" } }]
      };
      const prisma = {
        workflow: { findFirst: async () => ({ id: "workflow-1" }) },
        workflowVersion: {
          findFirst: async () => ({
            id: "version-1",
            workflowId: "workflow-1",
            version: 1,
            graph: interactiveGraph
          })
        }
      };
      const service = new WorkflowSchedulesService(prisma as never, new WorkflowSchedulePlanner(), {
        getInteractiveApprovalToolIds: async () => ["mcp_ticket"]
      } as never);

      await assert.rejects(
        () =>
          service.createSchedule(
            "workflow-1",
            {
              name: "提醒",
              workflowVersionId: "version-1",
              cronExpression: "0 9 * * *",
              timezone: "UTC",
              inputs: { city: "深圳" }
            },
            "user-1"
          ),
        (error) =>
          error instanceof AppError &&
          error.code === ErrorCodes.workflow.scheduleInteractiveToolUnsupported
      );
    }
  },
  {
    name: "WorkflowSchedulesService rejects stale revisions",
    run: async () => {
      const prisma = {
        workflowSchedule: {
          findFirst: async () => scheduleRecord(),
          updateMany: async () => ({ count: 0 })
        },
        workflow: { findFirst: async () => ({ id: "workflow-1" }) },
        workflowVersion: {
          findFirst: async () => ({ id: "version-1", workflowId: "workflow-1", version: 1, graph })
        }
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      await assert.rejects(
        () => service.pauseSchedule("schedule-1", 1),
        (error) =>
          error instanceof AppError && error.code === ErrorCodes.workflow.scheduleRevisionConflict
      );
    }
  },
  {
    name: "WorkflowSchedulesService resumes with a future nextRunAt and archives irreversibly",
    run: async () => {
      let state = scheduleRecord() as Omit<ReturnType<typeof scheduleRecord>, "status"> & {
        status: WorkflowScheduleStatus;
      };
      const prisma = {
        workflowSchedule: {
          findFirst: async () => state,
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            if (state.status === WorkflowScheduleStatus.ARCHIVED) return { count: 0 };
            state = scheduleRecord({
              ...state,
              ...data,
              revision: state.revision + 1,
              workflowVersion: { version: 1 }
            });
            return { count: 1 };
          }
        },
        workflow: { findFirst: async () => ({ id: "workflow-1" }) },
        workflowVersion: {
          findFirst: async () => ({ id: "version-1", workflowId: "workflow-1", version: 1, graph })
        }
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const resumed = await service.resumeSchedule("schedule-1", 1);
      assert.equal(resumed.status, "ACTIVE");
      assert.ok(resumed.nextRunAt && resumed.nextRunAt.getTime() > Date.now());
      await service.archiveSchedule("schedule-1", 2);
      await assert.rejects(
        () => service.resumeSchedule("schedule-1", 3),
        (error) => error instanceof AppError && error.code === ErrorCodes.workflow.scheduleArchived
      );
    }
  }
];
