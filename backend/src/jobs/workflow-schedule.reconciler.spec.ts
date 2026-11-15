import * as assert from "node:assert/strict";
import { AgentRunStatus } from "@prisma/client";

import { WorkflowScheduleReconciler } from "./workflow-schedule.reconciler";

export const tests = [
  {
    name: "WorkflowScheduleReconciler repairs only safe queue gaps and conservatively fails stale work",
    run: async () => {
      const finished: string[] = [];
      const failedAgentRuns: string[] = [];
      const schedules = {
        cancelArchivedQueuedScheduleRuns: async () => 1,
        listLinkedRunningScheduleRuns: async () => [
          { scheduleRunId: "schedule-run-terminal", agentRunId: "agent-run-terminal" }
        ],
        finishScheduleRun: async (id: string) => finished.push(id),
        listStaleRunningScheduleRuns: async () => [
          {
            scheduleRunId: "schedule-run-safe",
            scheduleId: "schedule-1",
            agentRunId: null,
            startedAt: null
          },
          {
            scheduleRunId: "schedule-run-risky",
            scheduleId: "schedule-1",
            agentRunId: "agent-run-risky",
            startedAt: new Date()
          }
        ],
        reconcileStaleRunningScheduleRun: async (run: { scheduleRunId: string }) =>
          run.scheduleRunId === "schedule-run-safe" ? "REQUEUED" : "FAILED",
        listStaleDispatchedScheduleJobs: async () => [
          { jobId: "job-lost", scheduleRunId: "schedule-run-lost" }
        ],
        rescheduleLostDispatchedJob: async () => true
      };
      const reconciler = new WorkflowScheduleReconciler(
        schedules as never,
        {
          getRunStatusSnapshots: async () => [
            { runId: "agent-run-terminal", status: AgentRunStatus.COMPLETED }
          ],
          failRun: async (runId: string) => {
            failedAgentRuns.push(runId);
          }
        } as never,
        { hasRunnableJob: async () => false } as never
      );

      const result = await reconciler.reconcileOnce(new Date("2026-11-15T00:00:00.000Z"));

      assert.deepEqual(result, {
        archivedCanceled: 1,
        lostJobsRescheduled: 1,
        terminalRunsReconciled: 1,
        staleRunsRequeued: 1,
        staleRunsFailed: 1
      });
      assert.deepEqual(finished, ["schedule-run-terminal"]);
      assert.deepEqual(failedAgentRuns, ["agent-run-risky"]);
    }
  },
  {
    name: "WorkflowScheduleReconciler keeps DISPATCHED state while a BullMQ job is runnable",
    run: async () => {
      let rescheduled = false;
      const reconciler = new WorkflowScheduleReconciler(
        {
          cancelArchivedQueuedScheduleRuns: async () => 0,
          listLinkedRunningScheduleRuns: async () => [],
          listStaleRunningScheduleRuns: async () => [],
          listStaleDispatchedScheduleJobs: async () => [{ jobId: "job-1", scheduleRunId: "run-1" }],
          rescheduleLostDispatchedJob: async () => {
            rescheduled = true;
            return true;
          }
        } as never,
        { getRunStatusSnapshots: async () => [] } as never,
        { hasRunnableJob: async () => true } as never
      );

      assert.equal((await reconciler.reconcileOnce()).lostJobsRescheduled, 0);
      assert.equal(rescheduled, false);
    }
  }
];
