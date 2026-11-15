import * as assert from "node:assert/strict";
import { WorkflowRunMode } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowScheduledRunsService } from "./workflow-scheduled-runs.service";

const scheduleRun = {
  scheduleRunId: "schedule-run-1",
  workspaceId: "workspace-1",
  scheduleId: "schedule-1",
  workflowId: "workflow-1",
  workflowVersionId: "version-fixed",
  requestId: "request-1",
  inputs: { city: "深圳" },
  timeoutSeconds: 60,
  agentRunId: null
};

function traceDouble() {
  const calls: string[] = [];
  const trace = {
    runId: "agent-run-1",
    sequence: 1,
    activeSteps: new Map(),
    firstTokenRecorded: false,
    terminal: false
  };
  return {
    calls,
    service: {
      stringifyPreview: (value: unknown) => JSON.stringify(value),
      prepareScheduled: async () => {
        calls.push("prepare");
        return trace;
      },
      startPrepared: async () => {
        calls.push("start");
      },
      record: async (_trace: unknown, event: { type: string }) => {
        calls.push(`record:${event.type}`);
      },
      ensureTerminal: async () => {
        calls.push("ensure-terminal");
      },
      fail: async (_trace: unknown, error: { type: string }) => {
        calls.push(`fail:${error.type}`);
      },
      timeout: async () => {
        calls.push("timeout");
      }
    }
  };
}

const cancellations = {
  watch: () => () => undefined
};
const scheduleControl = {
  isScheduleRunCancellationRequested: async () => false,
  heartbeatScheduleRun: async () => true
};

export const tests = [
  {
    name: "WorkflowScheduledRunsService executes the pinned version and converges success",
    run: async () => {
      const trace = traceDouble();
      let runtimeRequest: Record<string, unknown> | undefined;
      let finished: Record<string, unknown> | undefined;
      const schedules = {
        ...scheduleControl,
        claimScheduleRunExecution: async () => scheduleRun,
        linkScheduleRunAgentRun: async () => trace.calls.push("link"),
        assertScheduleRunExecutable: async () => trace.calls.push("validate"),
        finishScheduleRun: async (_id: string, status: string, error: unknown) => {
          finished = { status, error };
        }
      };
      const runtime = {
        async *runWorkflow(request: Record<string, unknown>) {
          runtimeRequest = request;
          yield { type: "workflow_started", data: {} };
          yield { type: "workflow_completed", data: { output: { ok: true } } };
        }
      };
      const service = new WorkflowScheduledRunsService(
        schedules as never,
        runtime as never,
        trace.service as never,
        cancellations as never
      );

      const result = await service.execute("schedule-run-1", "worker-1");

      assert.equal(result.status, "COMPLETED");
      assert.equal(runtimeRequest?.workflowVersionId, "version-fixed");
      assert.equal(runtimeRequest?.mode, WorkflowRunMode.PUBLISHED);
      assert.equal(runtimeRequest?.userId, undefined);
      assert.deepEqual(finished, { status: "COMPLETED", error: undefined });
      assert.deepEqual(trace.calls.slice(0, 4), ["prepare", "link", "start", "validate"]);
    }
  },
  {
    name: "WorkflowScheduledRunsService ignores a duplicate job that cannot claim execution",
    run: async () => {
      let runtimeCalled = false;
      const service = new WorkflowScheduledRunsService(
        { claimScheduleRunExecution: async () => null } as never,
        {
          runWorkflow: () => {
            runtimeCalled = true;
            throw new Error("duplicate job must not execute");
          }
        } as never,
        {} as never,
        cancellations as never
      );

      assert.deepEqual(await service.execute("schedule-run-1", "worker-2"), {
        acquired: false,
        scheduleRunId: "schedule-run-1"
      });
      assert.equal(runtimeCalled, false);
    }
  },
  {
    name: "WorkflowScheduledRunsService maps dynamic approval rejection to a stable failure",
    run: async () => {
      const trace = traceDouble();
      let terminalError: { type: string; message: string } | undefined;
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => scheduleRun,
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => {
            throw new AppError(
              ErrorCodes.workflow.scheduleInteractiveToolUnsupported,
              "需要人工审批"
            );
          },
          finishScheduleRun: async (_id: string, _status: string, error: typeof terminalError) => {
            terminalError = error;
          }
        } as never,
        {} as never,
        trace.service as never,
        cancellations as never
      );

      const result = await service.execute("schedule-run-1", "worker-1");

      assert.equal(result.status, "FAILED");
      assert.equal(terminalError?.type, "interactive_approval_not_supported");
      assert.ok(trace.calls.includes("fail:interactive_approval_not_supported"));
    }
  },
  {
    name: "WorkflowScheduledRunsService aborts the Runtime on total timeout",
    run: async () => {
      const trace = traceDouble();
      let finishedStatus: string | undefined;
      const runtime = {
        async *runWorkflow(request: { signal: AbortSignal }) {
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) return resolve();
            request.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "workflow_canceled", data: {} };
        }
      };
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => ({ ...scheduleRun, timeoutSeconds: 0.001 }),
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => undefined,
          finishScheduleRun: async (_id: string, status: string) => {
            finishedStatus = status;
          }
        } as never,
        runtime as never,
        trace.service as never,
        cancellations as never
      );

      const result = await service.execute("schedule-run-1", "worker-1");

      assert.equal(result.status, "TIMED_OUT");
      assert.equal(finishedStatus, "TIMED_OUT");
      assert.ok(trace.calls.includes("timeout"));
    }
  },
  {
    name: "WorkflowScheduledRunsService propagates worker shutdown as cancellation",
    run: async () => {
      const trace = traceDouble();
      const shutdown = new AbortController();
      let observedAbort = false;
      const runtime = {
        async *runWorkflow(request: { signal: AbortSignal }) {
          await new Promise<void>((resolve) => {
            request.signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                resolve();
              },
              { once: true }
            );
          });
          yield { type: "workflow_canceled", data: {} };
        }
      };
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => scheduleRun,
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => undefined,
          finishScheduleRun: async () => undefined
        } as never,
        runtime as never,
        trace.service as never,
        cancellations as never
      );

      const execution = service.execute("schedule-run-1", "worker-1", shutdown.signal);
      setImmediate(() => shutdown.abort());
      const result = await execution;

      assert.equal(observedAbort, true);
      assert.equal(result.status, "CANCELED");
    }
  },
  {
    name: "WorkflowScheduledRunsService observes shutdown that happened before execution",
    run: async () => {
      const trace = traceDouble();
      const shutdown = new AbortController();
      shutdown.abort();
      let runtimeSignalAborted = false;
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => scheduleRun,
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => undefined,
          finishScheduleRun: async () => undefined
        } as never,
        {
          async *runWorkflow(request: { signal: AbortSignal }) {
            runtimeSignalAborted = request.signal.aborted;
            yield { type: "workflow_canceled", data: {} };
          }
        } as never,
        trace.service as never,
        cancellations as never
      );

      const result = await service.execute("schedule-run-1", "worker-1", shutdown.signal);

      assert.equal(runtimeSignalAborted, true);
      assert.equal(result.status, "CANCELED");
    }
  },
  {
    name: "WorkflowScheduledRunsService observes database cancellation without Pub/Sub",
    run: async () => {
      const trace = traceDouble();
      let runtimeSignalAborted = false;
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => scheduleRun,
          isScheduleRunCancellationRequested: async () => true,
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => undefined,
          finishScheduleRun: async () => undefined
        } as never,
        {
          async *runWorkflow(request: { signal: AbortSignal }) {
            runtimeSignalAborted = request.signal.aborted;
            yield { type: "workflow_canceled", data: {} };
          }
        } as never,
        trace.service as never,
        cancellations as never
      );

      const result = await service.execute("schedule-run-1", "worker-1");

      assert.equal(runtimeSignalAborted, true);
      assert.equal(result.status, "CANCELED");
    }
  },
  {
    name: "WorkflowScheduledRunsService heartbeat polls cancellation after Pub/Sub loss",
    run: async () => {
      const trace = traceDouble();
      let cancellationReads = 0;
      let heartbeatWrites = 0;
      const service = new WorkflowScheduledRunsService(
        {
          ...scheduleControl,
          claimScheduleRunExecution: async () => scheduleRun,
          isScheduleRunCancellationRequested: async () => {
            cancellationReads += 1;
            return cancellationReads > 1;
          },
          heartbeatScheduleRun: async () => {
            heartbeatWrites += 1;
            return true;
          },
          linkScheduleRunAgentRun: async () => undefined,
          assertScheduleRunExecutable: async () => undefined,
          finishScheduleRun: async () => undefined
        } as never,
        {
          async *runWorkflow(request: { signal: AbortSignal }) {
            await new Promise<void>((resolve) =>
              request.signal.addEventListener("abort", () => resolve(), { once: true })
            );
            yield { type: "workflow_canceled", data: {} };
          }
        } as never,
        trace.service as never,
        cancellations as never
      );
      (service as unknown as { heartbeatMs: number }).heartbeatMs = 1;

      const result = await service.execute("schedule-run-1", "worker-1");

      assert.equal(result.status, "CANCELED");
      assert.ok(heartbeatWrites >= 1);
    }
  }
];
