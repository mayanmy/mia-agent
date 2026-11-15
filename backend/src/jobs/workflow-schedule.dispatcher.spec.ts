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
  }
];
