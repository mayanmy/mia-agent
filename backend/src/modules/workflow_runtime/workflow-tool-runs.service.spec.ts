import * as assert from "node:assert/strict";
import { AgentRunSource, AgentRunStepType, WorkflowRunMode } from "@prisma/client";

import { WorkflowRunTraceService } from "./workflow-run-trace.service";
import { WorkflowToolRunsService } from "./workflow-tool-runs.service";

function createService(events: Array<{ type: string; data: Record<string, unknown> }>) {
  const calls: Array<{ method: string; payload?: unknown }> = [];
  let runtimeRequest: Record<string, unknown> | undefined;
  const runs = {
    createRun: async (payload: unknown) => {
      calls.push({ method: "createRun", payload });
      return { runId: "workflow-run-1", requestId: "request-1", status: "QUEUED" };
    },
    startRun: async () => calls.push({ method: "startRun" }),
    startStep: async (payload: Record<string, unknown>) => {
      calls.push({ method: "startStep", payload });
      return {
        stepId: `step-${String(payload.nodeId)}`,
        runId: "workflow-run-1",
        sequence: payload.sequence,
        startedAt: new Date()
      };
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
  const service = new WorkflowToolRunsService(
    {
      parseWorkflowToolId: () => ({ workflowId: "workflow-1", workflowVersionId: "version-1" })
    } as never,
    {
      runWorkflow: async function* (request: Record<string, unknown>) {
        runtimeRequest = request;
        for (const event of events) yield event;
      }
    } as never,
    new WorkflowRunTraceService(runs as never)
  );
  return { calls, service, getRuntimeRequest: () => runtimeRequest };
}

const request = {
  toolId: "workflow:workflow-1:version-1",
  input: { question: "流水线为什么失败" },
  requestId: "request-1",
  runId: "outer-agent-run",
  stepId: "outer-tool-step",
  agentId: "agent-1",
  userId: "user-1",
  runSource: AgentRunSource.INTERNAL_CHAT
};

export const tests = [
  {
    name: "WorkflowToolRunsService creates a child Workflow Run with Agent and node Steps",
    run: async () => {
      const { calls, service, getRuntimeRequest } = createService([
        { type: "workflow_started", data: {} },
        {
          type: "node_started",
          data: { nodeId: "tool-1", nodeType: "tool", name: "查询部署", attempt: 1 }
        },
        {
          type: "node_completed",
          data: { nodeId: "tool-1", nodeType: "tool", output: { status: "canceled" } }
        },
        { type: "workflow_completed", data: { output: { answer: "部署已取消" } } }
      ]);

      const result = await service.execute(request);
      const createPayload = calls.find((call) => call.method === "createRun")?.payload as Record<
        string,
        unknown
      >;
      const stepPayload = calls.find((call) => call.method === "startStep")?.payload as Record<
        string,
        unknown
      >;

      assert.equal(result.ok, true);
      assert.equal(createPayload.source, AgentRunSource.INTERNAL_CHAT);
      assert.equal(createPayload.agentId, "agent-1");
      assert.equal(createPayload.workflowId, "workflow-1");
      assert.equal(createPayload.workflowVersionId, "version-1");
      assert.equal(createPayload.workflowRunMode, WorkflowRunMode.PUBLISHED);
      assert.equal(stepPayload.type, AgentRunStepType.TOOL);
      assert.equal(stepPayload.nodeId, "tool-1");
      assert.equal(getRuntimeRequest()?.runId, "workflow-run-1");
      assert.notEqual(getRuntimeRequest()?.runId, request.runId);
      assert.deepEqual(
        calls.map((call) => call.method),
        ["createRun", "startRun", "startStep", "completeStep", "completeRun"]
      );
    }
  },
  {
    name: "WorkflowToolRunsService persists failed node and child Workflow Run",
    run: async () => {
      const error = { type: "workflow_tool_failed", message: "HTTP 503", retryable: true };
      const { calls, service } = createService([
        {
          type: "node_started",
          data: { nodeId: "tool-1", nodeType: "tool", name: "查询部署", attempt: 1 }
        },
        { type: "node_failed", data: { nodeId: "tool-1", nodeType: "tool", error } },
        { type: "workflow_failed", data: { error } }
      ]);

      const result = await service.execute(request);

      assert.equal(result.ok, false);
      assert.equal(result.errorType, "workflow_tool_failed");
      assert.deepEqual(
        calls.map((call) => call.method),
        ["createRun", "startRun", "startStep", "failStep", "failRun"]
      );
    }
  }
];
