import * as assert from "node:assert/strict";

import { WorkflowScheduleConsumer } from "./workflow-schedule.consumer";

export const tests = [
  {
    name: "WorkflowScheduleConsumer passes only the ScheduleRun ID to the executor",
    run: async () => {
      let received: { scheduleRunId: string; workerId: string; signal: AbortSignal } | undefined;
      const consumer = new WorkflowScheduleConsumer(
        {} as never,
        {} as never,
        {
          execute: async (scheduleRunId: string, workerId: string, signal: AbortSignal) => {
            received = { scheduleRunId, workerId, signal };
            return { acquired: true, scheduleRunId, status: "COMPLETED" };
          }
        } as never
      );

      await consumer.executeJob({ scheduleRunId: "schedule-run-1", ignored: "value" });

      assert.equal(received?.scheduleRunId, "schedule-run-1");
      assert.ok(received?.workerId);
      assert.equal(received?.signal.aborted, false);
      await assert.rejects(() => consumer.executeJob({}), /缺少 scheduleRunId/u);
    }
  },
  {
    name: "WorkflowScheduleConsumer aborts active executions during shutdown",
    run: async () => {
      let observedAbort = false;
      const consumer = new WorkflowScheduleConsumer(
        {} as never,
        {} as never,
        {
          execute: async (_id: string, _workerId: string, signal: AbortSignal) =>
            new Promise((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  observedAbort = true;
                  resolve({ acquired: true, scheduleRunId: "schedule-run-1", status: "CANCELED" });
                },
                { once: true }
              );
            })
        } as never
      );

      const execution = consumer.executeJob({ scheduleRunId: "schedule-run-1" });
      await consumer.onModuleDestroy();
      await execution;

      assert.equal(observedAbort, true);
    }
  }
];
