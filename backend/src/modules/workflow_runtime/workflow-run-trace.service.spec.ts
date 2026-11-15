import * as assert from "node:assert/strict";

import { WorkflowRunTraceService } from "./workflow-run-trace.service";

export const tests = [
  {
    name: "WorkflowRunTraceService records workflow total timeout as TIMED_OUT",
    run: async () => {
      let timedOutRunId: string | undefined;
      let failed = false;
      const service = new WorkflowRunTraceService({
        timeoutRun: async (runId: string) => {
          timedOutRunId = runId;
        },
        failRun: async () => {
          failed = true;
        }
      } as never);
      const trace = {
        runId: "agent-run-1",
        sequence: 1,
        activeSteps: new Map(),
        firstTokenRecorded: false,
        terminal: false
      };

      await service.record(trace, {
        type: "workflow_failed",
        data: {
          error: {
            type: "workflow_timeout",
            message: "Workflow 执行超时",
            retryable: true
          }
        }
      });

      assert.equal(timedOutRunId, "agent-run-1");
      assert.equal(failed, false);
      assert.equal(trace.terminal, true);
    }
  }
];
