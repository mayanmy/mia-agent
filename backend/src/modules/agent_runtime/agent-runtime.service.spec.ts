import * as assert from "node:assert/strict";
import { AgentRunSource, AgentRunStepType } from "@prisma/client";

import { AgentRuntimeService } from "./agent-runtime.service";

export const tests = [
  {
    name: "AgentRuntimeService owns trace creation and stable step ordering",
    async run(): Promise<void> {
      const startedSteps: Array<{ sequence: number; name: string }> = [];
      const runs = {
        createRun: async () => ({ runId: "run-1", requestId: "request-1" }),
        startRun: async () => undefined,
        startStep: async (input: { sequence: number; name: string }) => {
          startedSteps.push(input);
          return { stepId: `step-${input.sequence}` };
        },
        completeStep: async () => undefined,
        failStep: async () => undefined,
        markFirstToken: async () => undefined,
        completeRun: async () => undefined,
        failRun: async () => undefined,
        cancelRun: async () => undefined
      };
      const runtime = new AgentRuntimeService(runs as never);
      const trace = await runtime.createTrace({
        requestId: "request-1",
        source: AgentRunSource.INTERNAL_CHAT,
        agentId: "agent-1",
        inputPreview: "hello",
        modelConfigId: "model-1"
      });

      await runtime.startStep(trace, AgentRunStepType.RETRIEVAL, "retrieval");
      await runtime.startStep(trace, AgentRunStepType.MODEL, "model");

      assert.deepEqual(startedSteps, [
        { runId: "run-1", sequence: 1, type: AgentRunStepType.RETRIEVAL, name: "retrieval", input: undefined },
        { runId: "run-1", sequence: 2, type: AgentRunStepType.MODEL, name: "model", input: undefined }
      ]);
    }
  },
  {
    name: "AgentRuntimeService cancels interrupted traces only once",
    async run(): Promise<void> {
      let cancelCount = 0;
      const runtime = new AgentRuntimeService({
        cancelRun: async () => {
          cancelCount += 1;
        }
      } as never);
      const trace = {
        runId: "run-1",
        requestId: "request-1",
        nextSequence: 1,
        firstTokenRecorded: false,
        terminal: false
      };
      const controller = new AbortController();
      controller.abort();

      await runtime.finishInterruptedTrace(trace, controller.signal);
      await runtime.finishInterruptedTrace(trace, controller.signal);

      assert.equal(cancelCount, 1);
      assert.equal(trace.terminal, true);
    }
  },
  {
    name: "AgentRuntimeService exposes retryability without leaking internal objects",
    async run(): Promise<void> {
      const runtime = new AgentRuntimeService();
      const error = runtime.toPublicError({
        type: "model_timeout",
        message: "provider timed out"
      });

      assert.deepEqual(error, {
        type: "model_timeout",
        message: "provider timed out",
        publicMessage: "provider timed out",
        retryable: true
      });
    }
  }
];
