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
  },
  {
    name: "WorkflowSchedulesService atomically materializes an idempotent Run and Outbox",
    run: async () => {
      const locked = scheduleRecord({
        status: WorkflowScheduleStatus.ACTIVE,
        cronExpression: "* * * * *",
        timezone: "UTC",
        nextRunAt: new Date("2026-11-15T00:01:00.000Z")
      }) as Omit<ReturnType<typeof scheduleRecord>, "nextRunAt" | "status"> & {
        nextRunAt: Date | null;
        status: WorkflowScheduleStatus;
      };
      const runs = new Map<string, { id: string; scheduledFor: Date }>();
      const jobs = new Set<string>();
      const transaction = {
        $queryRaw: async () => [locked],
        workflowScheduleRun: {
          createMany: async ({ data }: { data: Array<{ id: string; scheduledFor: Date }> }) => {
            let count = 0;
            for (const item of data) {
              const key = item.scheduledFor.toISOString();
              if (runs.has(key)) continue;
              runs.set(key, item);
              count += 1;
            }
            return { count };
          },
          findMany: async () => [...runs.values()].map((run) => ({ id: run.id }))
        },
        workflowScheduleJob: {
          createMany: async ({ data }: { data: Array<{ scheduleRunId: string }> }) => {
            let count = 0;
            for (const item of data) {
              if (jobs.has(item.scheduleRunId)) continue;
              jobs.add(item.scheduleRunId);
              count += 1;
            }
            return { count };
          }
        },
        workflowSchedule: {
          update: async ({ data }: { data: { nextRunAt: Date } }) => {
            locked.nextRunAt = data.nextRunAt;
            return locked;
          }
        }
      };
      const prisma = {
        $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );
      const first = await service.materializeDueRuns(
        "schedule-1",
        new Date("2026-11-15T00:01:30.000Z")
      );
      const second = await service.materializeDueRuns(
        "schedule-1",
        new Date("2026-11-15T00:01:30.000Z")
      );

      assert.equal(first.createdRunCount, 1);
      assert.equal(jobs.size, 1);
      assert.equal(second.createdRunCount, 0);
      assert.equal(locked.nextRunAt?.toISOString(), "2026-11-15T00:02:00.000Z");
    }
  },
  {
    name: "WorkflowSchedulesService rechecks a paused Schedule after candidate selection",
    run: async () => {
      let createCalled = false;
      const transaction = {
        $queryRaw: async () => [
          scheduleRecord({
            status: WorkflowScheduleStatus.PAUSED,
            nextRunAt: new Date("2026-11-15T00:01:00.000Z")
          })
        ],
        workflowScheduleRun: {
          createMany: async () => {
            createCalled = true;
            return { count: 1 };
          }
        }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );
      const result = await service.materializeDueRuns(
        "schedule-1",
        new Date("2026-11-15T00:02:00.000Z")
      );

      assert.equal(result.createdRunCount, 0);
      assert.equal(createCalled, false);
    }
  },
  {
    name: "WorkflowSchedulesService does not advance nextRunAt when Outbox creation fails",
    run: async () => {
      let updateCalled = false;
      const transaction = {
        $queryRaw: async () => [
          scheduleRecord({
            status: WorkflowScheduleStatus.ACTIVE,
            cronExpression: "* * * * *",
            timezone: "UTC",
            nextRunAt: new Date("2026-11-15T00:01:00.000Z")
          })
        ],
        workflowScheduleRun: {
          createMany: async () => ({ count: 1 }),
          findMany: async () => [{ id: "run-1" }]
        },
        workflowScheduleJob: {
          createMany: async () => {
            throw new Error("database unavailable");
          }
        },
        workflowSchedule: {
          update: async () => {
            updateCalled = true;
          }
        }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      await assert.rejects(
        () => service.materializeDueRuns("schedule-1", new Date("2026-11-15T00:01:30.000Z")),
        /database unavailable/u
      );
      assert.equal(updateCalled, false);
    }
  }
];
