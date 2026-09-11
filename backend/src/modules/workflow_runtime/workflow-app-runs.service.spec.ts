import * as assert from "node:assert/strict";
import { AgentRunSource, AgentRunStepType } from "@prisma/client";

import { WorkflowAppRunsService } from "./workflow-app-runs.service";

function createService(events: Array<{ type: string; data: Record<string, unknown> }>) {
  const calls: Array<{ method: string; payload?: unknown }> = [];
  const workflows = {
    getPublishedApp: async () => ({ workflowVersionId: "version-1" })
  };
  const runtime = {
    runWorkflow: async function* () {
      for (const event of events) yield event;
    }
  };
  const runs = {
    createRun: async (payload: unknown) => {
      calls.push({ method: "createRun", payload });
      return { runId: "run-1", requestId: "request-1", status: "QUEUED" };
    },
    startRun: async () => calls.push({ method: "startRun" }),
    startStep: async (payload: unknown) => {
      calls.push({ method: "startStep", payload });
      return { stepId: "step-1", runId: "run-1", sequence: 1, startedAt: new Date() };
    },
    completeStep: async (_stepId: string, payload: unknown) =>
      calls.push({ method: "completeStep", payload }),
    failStep: async (_stepId: string, payload: unknown) =>
      calls.push({ method: "failStep", payload }),
    markFirstToken: async () => calls.push({ method: "markFirstToken" }),
    completeRun: async (_runId: string, payload: unknown) =>
      calls.push({ method: "completeRun", payload }),
    failRun: async (_runId: string, payload: unknown) => calls.push({ method: "failRun", payload }),
    cancelRun: async () => calls.push({ method: "cancelRun" })
  };
  return {
    calls,
    service: new WorkflowAppRunsService(workflows as never, runtime as never, runs as never)
  };
}

const request = {
  requestId: "request-1",
  workflowId: "workflow-1",
  workflowVersionId: "version-1",
  userId: "user-1",
  inputs: { query: "部署失败" }
};

export const tests = [
  {
    name: "WorkflowAppRunsService persists standalone Run and completed node Steps",
    run: async () => {
      const { service, calls } = createService([
        { type: "workflow_started", data: {} },
        {
          type: "node_started",
          data: { nodeId: "tool-1", nodeType: "tool", name: "查询部署", attempt: 1 }
        },
        {
          type: "node_completed",
          data: { nodeId: "tool-1", nodeType: "tool", output: { ok: true } }
        },
        { type: "token", data: { content: "已" } },
        { type: "token", data: { content: "定位" } },
        { type: "workflow_completed", data: { output: { answer: "已定位" } } }
      ]);

      const result = await service.runWorkflowApp(request);
      const createPayload = calls.find((call) => call.method === "createRun")?.payload as Record<
        string,
        unknown
      >;
      const stepPayload = calls.find((call) => call.method === "startStep")?.payload as Record<
        string,
        unknown
      >;

      assert.equal(result.ok, true);
      assert.equal(createPayload.source, AgentRunSource.WORKFLOW_APP);
      assert.equal(createPayload.agentId, undefined);
      assert.equal(stepPayload.type, AgentRunStepType.TOOL);
      assert.deepEqual(
        calls.map((call) => call.method),
        ["createRun", "startRun", "startStep", "completeStep", "markFirstToken", "completeRun"]
      );
    }
  },
  {
    name: "WorkflowAppRunsService persists failed node and failed Run",
    run: async () => {
      const error = { type: "tool_failed", message: "工具失败", retryable: false };
      const { service, calls } = createService([
        {
          type: "node_started",
          data: { nodeId: "tool-1", nodeType: "tool", name: "查询部署", attempt: 1 }
        },
        { type: "node_failed", data: { nodeId: "tool-1", nodeType: "tool", error } },
        { type: "workflow_failed", data: { error } }
      ]);

      const result = await service.runWorkflowApp(request);

      assert.equal(result.ok, false);
      assert.equal(result.error?.type, "tool_failed");
      assert.deepEqual(
        calls.map((call) => call.method),
        ["createRun", "startRun", "startStep", "failStep", "failRun"]
      );
    }
  }
];
