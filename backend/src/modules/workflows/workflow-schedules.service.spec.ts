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
      assert.deepEqual(
        Reflect.getMetadata(
          "mia:workspace-roles",
          WorkflowSchedulesController.prototype.cancelScheduleRun
        ),
        ["OWNER", "MANAGER"]
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
  },
  {
    name: "WorkflowSchedulesService grants only one worker the QUEUED ScheduleRun",
    run: async () => {
      let status = "QUEUED";
      const updates: Array<Record<string, unknown>> = [];
      const current = () => ({
        id: "schedule-run-1",
        workspaceId,
        scheduleId: "schedule-1",
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        requestId: "request-1",
        inputSnapshot: { city: "深圳" },
        agentRunId: null,
        cancelRequestedAt: null,
        status,
        schedule: {
          timeoutSeconds: 1800,
          concurrencyPolicy: "QUEUE",
          status: "ACTIVE"
        }
      });
      const transaction = {
        $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
        workflowScheduleRun: {
          updateMany: async (query: Record<string, unknown>) => {
            updates.push(query);
            if (status !== "QUEUED") return { count: 0 };
            status = "RUNNING";
            return { count: 1 };
          },
          findUnique: async ({ include }: { include?: unknown }) =>
            include ? current() : { scheduleId: "schedule-1" },
          count: async () => (status === "RUNNING" ? 1 : 0)
        },
        workflowSchedule: { update: async () => undefined }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const first = await service.claimScheduleRunExecution("schedule-run-1", "worker-1");
      const duplicate = await service.claimScheduleRunExecution("schedule-run-1", "worker-2");

      assert.equal(first?.workflowVersionId, "version-1");
      assert.equal(first?.timeoutSeconds, 1800);
      assert.equal(duplicate, null);
      assert.deepEqual((updates[0].where as Record<string, unknown>).status, "QUEUED");
      assert.deepEqual((updates[0].data as Record<string, unknown>).attempt, { increment: 1 });
    }
  },
  {
    name: "WorkflowSchedulesService defers QUEUE overlap without incrementing business attempt",
    run: async () => {
      let runClaimed = false;
      let deferredData: Record<string, unknown> | undefined;
      const transaction = {
        $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
        workflowScheduleRun: {
          findUnique: async ({ include }: { include?: unknown }) =>
            include
              ? {
                  id: "run-queued",
                  workspaceId,
                  scheduleId: "schedule-1",
                  workflowId: "workflow-1",
                  workflowVersionId: "version-1",
                  requestId: "request-1",
                  inputSnapshot: {},
                  agentRunId: null,
                  cancelRequestedAt: null,
                  status: "QUEUED",
                  schedule: {
                    timeoutSeconds: 1800,
                    concurrencyPolicy: "QUEUE",
                    status: "ACTIVE"
                  }
                }
              : { scheduleId: "schedule-1" },
          count: async () => 1,
          updateMany: async () => {
            runClaimed = true;
            return { count: 1 };
          }
        },
        workflowScheduleJob: {
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            deferredData = data;
            return { count: 1 };
          }
        }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      assert.equal(await service.claimScheduleRunExecution("run-queued", "worker-1"), null);
      assert.equal(runClaimed, false);
      assert.equal(deferredData?.dispatchStatus, "PENDING");
      assert.equal(deferredData?.lastErrorCode, "schedule_concurrency_deferred");
      assert.equal("attempt" in (deferredData ?? {}), false);
    }
  },
  {
    name: "WorkflowSchedulesService marks SKIP overlap as an auditable terminal Run",
    run: async () => {
      let runData: Record<string, unknown> | undefined;
      let jobStatus: unknown;
      const transaction = {
        $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
        workflowScheduleRun: {
          findUnique: async ({ include }: { include?: unknown }) =>
            include
              ? {
                  id: "run-skipped",
                  workspaceId,
                  scheduleId: "schedule-1",
                  workflowId: "workflow-1",
                  workflowVersionId: "version-1",
                  requestId: "request-1",
                  inputSnapshot: {},
                  agentRunId: null,
                  cancelRequestedAt: null,
                  status: "QUEUED",
                  schedule: {
                    timeoutSeconds: 1800,
                    concurrencyPolicy: "SKIP",
                    status: "ACTIVE"
                  }
                }
              : { scheduleId: "schedule-1" },
          count: async () => 1,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            runData = data;
          }
        },
        workflowScheduleJob: {
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            jobStatus = data.dispatchStatus;
          }
        },
        workflowSchedule: { update: async () => undefined }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      assert.equal(await service.claimScheduleRunExecution("run-skipped", "worker-1"), null);
      assert.equal(runData?.status, "SKIPPED");
      assert.equal(runData?.errorType, "schedule_overlap_skipped");
      assert.equal(jobStatus, "COMPLETED");
    }
  },
  {
    name: "WorkflowSchedulesService allows up to three ALLOW runs and defers the fourth",
    run: async () => {
      const execute = async (runningCount: number) => {
        let claimed = false;
        let deferred = false;
        const transaction = {
          $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
          workflowScheduleRun: {
            findUnique: async ({ include }: { include?: unknown }) =>
              include
                ? {
                    id: "run-allow",
                    workspaceId,
                    scheduleId: "schedule-1",
                    workflowId: "workflow-1",
                    workflowVersionId: "version-1",
                    requestId: "request-1",
                    inputSnapshot: {},
                    agentRunId: null,
                    cancelRequestedAt: null,
                    status: "QUEUED",
                    schedule: {
                      timeoutSeconds: 1800,
                      concurrencyPolicy: "ALLOW",
                      status: "ACTIVE"
                    }
                  }
                : { scheduleId: "schedule-1" },
            count: async () => runningCount,
            updateMany: async () => {
              claimed = true;
              return { count: 1 };
            }
          },
          workflowScheduleJob: {
            updateMany: async () => {
              deferred = true;
            }
          },
          workflowSchedule: { update: async () => undefined }
        };
        const service = new WorkflowSchedulesService(
          {
            $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
              callback(transaction)
          } as never,
          new WorkflowSchedulePlanner(),
          tools as never
        );
        const result = await service.claimScheduleRunExecution("run-allow", "worker-1");
        return { result, claimed, deferred };
      };

      assert.equal((await execute(2)).claimed, true);
      assert.deepEqual(await execute(3), { result: null, claimed: false, deferred: true });
    }
  },
  {
    name: "WorkflowSchedulesService cancels QUEUED immediately and requests RUNNING cancellation",
    run: async () => {
      let status = "QUEUED";
      let cancelRequestedAt: Date | null = null;
      const transaction = {
        workflowScheduleRun: {
          findFirst: async () => ({
            id: "run-1",
            scheduleId: "schedule-1",
            status,
            cancelRequestedAt
          }),
          update: async ({ data }: { data: Record<string, unknown> }) => {
            status = String(data.status ?? status);
            cancelRequestedAt = (data.cancelRequestedAt as Date | undefined) ?? cancelRequestedAt;
          }
        },
        workflowScheduleJob: { updateMany: async () => ({ count: 1 }) },
        workflowSchedule: { update: async () => undefined }
      };
      const service = new WorkflowSchedulesService(
        {
          $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
            callback(transaction)
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const queued = await service.requestScheduleRunCancel("run-1");
      assert.equal(queued.status, "CANCELED");
      status = "RUNNING";
      cancelRequestedAt = null;
      const running = await service.requestScheduleRunCancel("run-1");
      assert.equal(running.status, "RUNNING");
      assert.ok(running.cancelRequestedAt);
    }
  },
  {
    name: "WorkflowSchedulesService materializes an idempotent manual backfill Run and Outbox",
    run: async () => {
      const scheduledFor = new Date("2026-11-15T08:00:00.000Z");
      let inserted = true;
      let outboxCreates = 0;
      const transaction = {
        workflowScheduleRun: {
          createMany: async () => ({ count: inserted ? 1 : 0 }),
          findFirstOrThrow: async () => ({
            id: "manual-run-1",
            status: "QUEUED",
            scheduledFor
          })
        },
        workflowScheduleJob: {
          create: async () => {
            outboxCreates += 1;
          }
        }
      };
      const prisma = {
        workflowSchedule: { findFirst: async () => scheduleRecord() },
        workflow: { findFirst: async () => ({ id: "workflow-1" }) },
        workflowVersion: {
          findFirst: async () => ({ id: "version-1", workflowId: "workflow-1", version: 1, graph })
        },
        $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
          callback(transaction)
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const created = await service.createManualRun("schedule-1", {
        scheduledFor: scheduledFor.toISOString()
      });
      inserted = false;
      const existing = await service.createManualRun("schedule-1", {
        scheduledFor: scheduledFor.toISOString()
      });

      assert.equal(created.existing, false);
      assert.equal(existing.existing, true);
      assert.equal(outboxCreates, 1);
    }
  },
  {
    name: "WorkflowSchedulesService returns paged run history with derived durations",
    run: async () => {
      const scheduledFor = new Date("2026-11-15T08:00:00.000Z");
      const startedAt = new Date("2026-11-15T08:00:02.000Z");
      const finishedAt = new Date("2026-11-15T08:00:05.500Z");
      let runWhere: Record<string, unknown> | undefined;
      const run = {
        id: "schedule-run-1",
        workspaceId,
        scheduleId: "schedule-1",
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        scheduledFor,
        trigger: "SCHEDULED",
        status: "COMPLETED",
        inputSnapshot: {},
        scheduleRevision: 1,
        requestId: "request-1",
        agentRunId: "agent-run-1",
        attempt: 1,
        workerId: "worker-1",
        heartbeatAt: finishedAt,
        cancelRequestedAt: null,
        startedAt,
        finishedAt,
        errorType: null,
        errorMessage: null,
        createdAt: scheduledFor,
        updatedAt: finishedAt
      };
      const service = new WorkflowSchedulesService(
        {
          workflowSchedule: { findFirst: async () => scheduleRecord() },
          workflowScheduleRun: {
            findMany: async ({ where }: { where: Record<string, unknown> }) => {
              runWhere = where;
              return [run];
            },
            count: async () => 1,
            findFirst: async () => run
          },
          workflowVersion: {
            findMany: async () => [{ id: "version-1", version: 1 }],
            findUnique: async () => ({ version: 1 })
          }
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const page = await service.listScheduleRuns("schedule-1", {
        page: 1,
        pageSize: 20,
        status: "COMPLETED"
      });
      const detail = await service.getScheduleRunDetail("schedule-run-1");

      assert.equal(page.list[0].queueWaitMs, 2_000);
      assert.equal(page.list[0].durationMs, 3_500);
      assert.equal(page.list[0].workflowVersion, 1);
      assert.equal(detail.requestId, "request-1");
      assert.equal((runWhere?.status as string | undefined) ?? null, "COMPLETED");
    }
  },
  {
    name: "WorkflowSchedulesService reports backlog health without exposing workspace data",
    run: async () => {
      const counts = [3, 1, 2, 1, 1, 4];
      const service = new WorkflowSchedulesService(
        {
          workflowSchedule: { count: async () => counts.shift() },
          workflowScheduleRun: {
            count: async () => counts.shift(),
            findFirst: async () => ({ createdAt: new Date("2026-11-12T23:59:30.000Z") })
          },
          workflowScheduleJob: { count: async () => counts.shift() }
        } as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const summary = await service.getOperationalHealthSummary(now, 60_000, 60_000);

      assert.deepEqual(summary, {
        activeSchedules: 3,
        overdueSchedules: 1,
        queuedRuns: 2,
        runningRuns: 1,
        staleRunningRuns: 1,
        pendingDispatches: 4,
        oldestQueuedSeconds: 30
      });
    }
  },
  {
    name: "WorkflowSchedulesService cleanup deletes only expired terminal status groups",
    run: async () => {
      const filters: Array<Record<string, unknown>> = [];
      const prisma = {
        workflowScheduleRun: {
          deleteMany: ({ where }: { where: Record<string, unknown> }) => {
            filters.push(where);
            return Promise.resolve({ count: filters.length });
          }
        },
        $transaction: async (operations: Array<Promise<{ count: number }>>) =>
          Promise.all(operations)
      };
      const service = new WorkflowSchedulesService(
        prisma as never,
        new WorkflowSchedulePlanner(),
        tools as never
      );

      const result = await service.cleanupExpiredRuns(90, 180, now);

      assert.deepEqual(result, { completedDeleted: 1, failedDeleted: 2 });
      assert.deepEqual((filters[0].status as { in: string[] }).in, [
        "COMPLETED",
        "CANCELED",
        "SKIPPED"
      ]);
      assert.deepEqual((filters[1].status as { in: string[] }).in, ["FAILED", "TIMED_OUT"]);
    }
  }
];
