import * as assert from "node:assert/strict";

import { WorkflowScheduleCancellationService } from "./workflow-schedule-cancellation.service";

export const tests = [
  {
    name: "WorkflowScheduleCancellationService persists cancellation before Redis notification",
    run: async () => {
      const calls: string[] = [];
      const service = new WorkflowScheduleCancellationService(
        {
          requestScheduleRunCancel: async () => {
            calls.push("database");
            return {
              runId: "run-1",
              status: "RUNNING",
              cancelRequestedAt: new Date()
            };
          }
        } as never,
        {
          isConfigured: () => true,
          publish: async () => calls.push("redis")
        } as never,
        { workflowScheduleCancelChannel: () => "mia:test:workflow-schedule:cancel" } as never
      );

      const result = await service.requestCancel("run-1");

      assert.equal(result.status, "RUNNING");
      assert.deepEqual(calls, ["database", "redis"]);
    }
  },
  {
    name: "WorkflowScheduleCancellationService keeps database cancellation when Redis fails",
    run: async () => {
      const service = new WorkflowScheduleCancellationService(
        {
          requestScheduleRunCancel: async () => ({
            runId: "run-1",
            status: "RUNNING",
            cancelRequestedAt: new Date()
          })
        } as never,
        {
          isConfigured: () => true,
          publish: async () => {
            throw new Error("redis unavailable");
          }
        } as never,
        { workflowScheduleCancelChannel: () => "cancel" } as never
      );

      assert.equal((await service.requestCancel("run-1")).status, "RUNNING");
    }
  }
];
