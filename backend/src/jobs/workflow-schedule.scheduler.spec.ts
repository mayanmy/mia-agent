import * as assert from "node:assert/strict";

import { WorkflowScheduleScheduler } from "./workflow-schedule.scheduler";

export const tests = [
  {
    name: "WorkflowScheduleScheduler isolates one bad Schedule from the rest of the batch",
    run: async () => {
      const calls: string[] = [];
      const service = {
        claimDueSchedules: async () => [
          { scheduleId: "bad", workspaceId: "workspace-1", nextRunAt: new Date() },
          { scheduleId: "good", workspaceId: "workspace-1", nextRunAt: new Date() }
        ],
        materializeDueRuns: async (scheduleId: string) => {
          calls.push(scheduleId);
          if (scheduleId === "bad") throw new Error("invalid cron");
          return {
            scheduleId,
            createdRunCount: 2,
            duplicateRunCount: 0,
            skippedCount: 1,
            skippedCountTruncated: false,
            nextRunAt: new Date(),
            locked: true
          };
        }
      };
      const scheduler = new WorkflowScheduleScheduler(service as never);
      const result = await scheduler.tick(new Date("2026-11-15T00:00:00.000Z"));

      assert.deepEqual(calls, ["bad", "good"]);
      assert.equal(result.createdRuns, 2);
      assert.equal(result.skippedOccurrences, 1);
      assert.equal(result.failedSchedules, 1);
    }
  },
  {
    name: "WorkflowScheduleScheduler coalesces overlapping ticks",
    run: async () => {
      let release: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      let claims = 0;
      const scheduler = new WorkflowScheduleScheduler({
        claimDueSchedules: async () => {
          claims += 1;
          await blocked;
          return [];
        }
      } as never);
      const first = scheduler.tick();
      const second = scheduler.tick();
      release?.();
      await Promise.all([first, second]);

      assert.equal(claims, 1);
    }
  }
];
