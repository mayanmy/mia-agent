import * as assert from "node:assert/strict";

import { WorkflowScheduleDispatcher } from "./workflow-schedule.dispatcher";
import { WorkflowScheduleQueue } from "./workflow-schedule.queue";

export const tests = [
  {
    name: "WorkflowScheduleDispatcher keeps Outbox pending during P2 dry-run",
    run: async () => {
      let marked = false;
      const service = {
        claimPendingScheduleJobs: async () => [
          { jobId: "job-1", scheduleRunId: "run-1", dispatchAttempts: 0 }
        ],
        markScheduleJobDispatched: async () => {
          marked = true;
        }
      };
      const dispatcher = new WorkflowScheduleDispatcher(
        service as never,
        new WorkflowScheduleQueue()
      );
      const result = await dispatcher.dispatchOnce(new Date("2026-11-15T00:00:00.000Z"));

      assert.deepEqual(result, { pendingJobs: 1, dryRunJobs: 1, dispatchedJobs: 0 });
      assert.equal(marked, false);
    }
  },
  {
    name: "WorkflowScheduleQueue emits ID-only deterministic BullMQ payloads",
    run: () => {
      const result = new WorkflowScheduleQueue().prepare({
        jobId: "outbox-1",
        scheduleRunId: "run-1",
        dispatchAttempts: 0
      });

      assert.deepEqual(result, {
        name: "execute-scheduled-run",
        jobId: "run-1",
        data: { scheduleRunId: "run-1" }
      });
    }
  },
  {
    name: "WorkflowScheduleDispatcher marks Outbox dispatched only after BullMQ enqueue",
    run: async () => {
      const calls: string[] = [];
      const dispatcher = new WorkflowScheduleDispatcher(
        {
          claimPendingScheduleJobs: async () => [
            { jobId: "job-1", scheduleRunId: "run-1", dispatchAttempts: 0 }
          ],
          markScheduleJobDispatched: async () => calls.push("mark")
        } as never,
        { enqueue: async () => calls.push("enqueue") } as never
      );
      (dispatcher as unknown as { config: { dispatcherDryRun: boolean } }).config.dispatcherDryRun =
        false;

      const result = await dispatcher.dispatchOnce(new Date("2026-11-15T00:00:00.000Z"));

      assert.deepEqual(calls, ["enqueue", "mark"]);
      assert.deepEqual(result, { pendingJobs: 1, dryRunJobs: 0, dispatchedJobs: 1 });
    }
  },
  {
    name: "WorkflowScheduleQueue removes a finished duplicate before concurrency re-dispatch",
    run: async () => {
      const calls: string[] = [];
      const queue = new WorkflowScheduleQueue();
      (queue as unknown as { queue: unknown }).queue = {
        getJob: async () => ({
          getState: async () => "completed",
          remove: async () => calls.push("remove")
        }),
        add: async () => calls.push("add")
      };

      await queue.enqueue({ jobId: "job-1", scheduleRunId: "run-1", dispatchAttempts: 1 });

      assert.deepEqual(calls, ["remove", "add"]);
    }
  },
  {
    name: "WorkflowScheduleQueue refuses to mark an active duplicate as re-dispatched",
    run: async () => {
      const queue = new WorkflowScheduleQueue();
      (queue as unknown as { queue: unknown }).queue = {
        getJob: async () => ({ getState: async () => "active", remove: async () => undefined }),
        add: async () => undefined
      };

      await assert.rejects(
        () => queue.enqueue({ jobId: "job-1", scheduleRunId: "run-1", dispatchAttempts: 1 }),
        /状态为 active/u
      );
    }
  }
];
