import * as assert from "node:assert/strict";
import { WorkflowRunMode } from "@prisma/client";

import { CompiledWorkflowPlan } from "../workflows/dto/compiled-plan.dto";
import { NodeExecutionEvent, WorkflowNodeExecutor } from "./dto/node-execution.dto";
import { WorkflowRunRequest, WorkflowRuntimeEvent } from "./dto/workflow-run.dto";
import { ConditionNodeExecutor } from "./executors/condition.executor";
import { EndNodeExecutor } from "./executors/end.executor";
import { StartNodeExecutor } from "./executors/start.executor";
import { TemplateNodeExecutor } from "./executors/template.executor";
import { WorkflowExpressionResolver } from "./expression-resolver";
import { WorkflowNodeExecutorRegistry } from "./node-executor.registry";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

const baseRequest: WorkflowRunRequest = {
  requestId: "request-1",
  runId: "run-1",
  agentId: "agent-1",
  workflowId: "workflow-1",
  workflowVersionId: "version-1",
  mode: WorkflowRunMode.PUBLISHED,
  inputs: { name: "Mia", vip: true }
};

const plan: CompiledWorkflowPlan = {
  schemaVersion: 1,
  startNodeId: "start",
  topologicalOrder: ["start", "template", "condition", "yes-end", "default-end"],
  nodes: {
    start: {
      id: "start",
      type: "start",
      name: "开始",
      config: {
        inputs: [
          { name: "name", type: "string", required: true },
          { name: "vip", type: "boolean", required: false, defaultValue: false }
        ]
      }
    },
    template: {
      id: "template",
      type: "template",
      name: "问候语",
      config: {
        template: {
          kind: "template",
          segments: ["你好，", { kind: "reference", source: "input", path: ["name"] }]
        }
      }
    },
    condition: {
      id: "condition",
      type: "condition",
      name: "会员判断",
      config: {
        branches: [
          {
            handle: "yes",
            left: { kind: "reference", source: "input", path: ["vip"] },
            operator: "eq",
            right: true
          }
        ],
        defaultHandle: "default"
      }
    },
    "yes-end": {
      id: "yes-end",
      type: "end",
      name: "会员结束",
      config: {
        output: { kind: "vip" },
        answer: { kind: "reference", source: "nodes", path: ["template", "output", "text"] }
      }
    },
    "default-end": {
      id: "default-end",
      type: "end",
      name: "普通结束",
      config: { output: { kind: "normal" }, answer: "普通用户" }
    }
  },
  outgoingEdges: {
    start: [{ id: "e1", target: "template" }],
    template: [{ id: "e2", target: "condition" }],
    condition: [
      { id: "e3", target: "yes-end", sourceHandle: "yes" },
      { id: "e4", target: "default-end", sourceHandle: "default" }
    ],
    "yes-end": [],
    "default-end": []
  },
  requiredInputs: [{ name: "name", type: "string", required: true }],
  resourceFingerprints: {}
};

function createRegistry(extra: WorkflowNodeExecutor[] = []): WorkflowNodeExecutorRegistry {
  const resolver = new WorkflowExpressionResolver();
  return new WorkflowNodeExecutorRegistry([
    new StartNodeExecutor(resolver),
    new TemplateNodeExecutor(resolver),
    new ConditionNodeExecutor(resolver),
    new EndNodeExecutor(resolver),
    ...extra
  ]);
}

function createRuntime(
  compiledPlan: CompiledWorkflowPlan,
  registry = createRegistry()
): WorkflowRuntimeService {
  return new WorkflowRuntimeService(
    {
      getPublishedRuntimeConfig: async () => ({
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        version: 1,
        graphSchemaVersion: 1,
        checksum: "checksum-1",
        compiledPlan: compiledPlan as unknown as Record<string, unknown>
      })
    } as never,
    registry
  );
}

async function collectEvents(
  runtime: WorkflowRuntimeService,
  request: WorkflowRunRequest = baseRequest
): Promise<WorkflowRuntimeEvent[]> {
  const events: WorkflowRuntimeEvent[] = [];
  for await (const event of runtime.runWorkflow(request)) events.push(event);
  return events;
}

export const tests = [
  {
    name: "WorkflowRuntime executes Start Template Condition and End in edge order",
    run: async () => {
      const events = await collectEvents(createRuntime(plan));
      const completed = events.at(-1);
      const startedNodeIds = events
        .filter((event) => event.type === "node_started")
        .map((event) => String(event.data.nodeId));

      assert.deepEqual(startedNodeIds, ["start", "template", "condition", "yes-end"]);
      assert.equal(completed?.type, "workflow_completed");
      assert.equal(completed?.data.answer, "你好，Mia");
      assert.deepEqual(completed?.data.output, { kind: "vip", answer: "你好，Mia" });
    }
  },
  {
    name: "WorkflowRuntime follows the Condition default Handle",
    run: async () => {
      const events = await collectEvents(createRuntime(plan), {
        ...baseRequest,
        inputs: { name: "Mia" }
      });
      const completed = events.at(-1);

      assert.equal(completed?.type, "workflow_completed");
      assert.equal(completed?.data.answer, "普通用户");
    }
  },
  {
    name: "WorkflowRuntime fails when Template references a missing value",
    run: async () => {
      const invalidPlan: CompiledWorkflowPlan = {
        ...plan,
        nodes: {
          ...plan.nodes,
          template: {
            ...plan.nodes.template,
            config: {
              template: { kind: "reference", source: "input", path: ["missing"] }
            }
          }
        }
      };
      const events = await collectEvents(createRuntime(invalidPlan));
      const failed = events.at(-1);

      assert.ok(events.some((event) => event.type === "node_failed"));
      assert.equal(failed?.type, "workflow_failed");
      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_reference_missing"
      );
    }
  },
  {
    name: "WorkflowNodeExecutorRegistry rejects duplicate node types",
    run: () => {
      const executor = {
        type: "start",
        execute: async () => ({ status: "completed", output: {} })
      };
      assert.throws(
        () =>
          new WorkflowNodeExecutorRegistry([
            executor as WorkflowNodeExecutor,
            executor as WorkflowNodeExecutor
          ]),
        /duplicate Workflow node executor/
      );
    }
  },
  {
    name: "WorkflowRuntime emits canceled when the caller already aborted",
    run: async () => {
      const controller = new AbortController();
      controller.abort();
      const events = await collectEvents(createRuntime(plan), {
        ...baseRequest,
        signal: controller.signal
      });

      assert.deepEqual(
        events.map((event) => event.type),
        ["workflow_canceled"]
      );
    }
  },
  {
    name: "WorkflowRuntime aborts a node after its configured timeout",
    run: async () => {
      const timeoutPlan: CompiledWorkflowPlan = {
        ...plan,
        topologicalOrder: ["slow"],
        startNodeId: "slow",
        nodes: {
          slow: {
            id: "slow",
            type: "slow",
            name: "慢节点",
            config: { timeoutSeconds: 0.001 }
          }
        },
        outgoingEdges: { slow: [] }
      };
      let executorSignal: AbortSignal | undefined;
      const slowExecutor: WorkflowNodeExecutor = {
        type: "slow",
        execute: async ({ signal }) => {
          executorSignal = signal;
          return new Promise(() => undefined);
        }
      };
      const events = await collectEvents(
        createRuntime(timeoutPlan, new WorkflowNodeExecutorRegistry([slowExecutor]))
      );
      const failed = events.at(-1);

      assert.ok(events.some((event) => event.type === "node_failed"));
      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_node_timeout"
      );
      assert.equal(executorSignal?.aborted, true);
    }
  },
  {
    name: "WorkflowRuntime stops a malformed loop at the execution limit",
    run: async () => {
      const loopPlan: CompiledWorkflowPlan = {
        ...plan,
        topologicalOrder: ["loop"],
        startNodeId: "loop",
        nodes: {
          loop: { id: "loop", type: "loop", name: "循环", config: {} }
        },
        outgoingEdges: { loop: [{ id: "loop-edge", target: "loop" }] }
      };
      const loopExecutor: WorkflowNodeExecutor = {
        type: "loop",
        execute: async () => ({ status: "completed", output: {} })
      };
      const events = await collectEvents(
        createRuntime(loopPlan, new WorkflowNodeExecutorRegistry([loopExecutor]))
      );
      const failed = events.at(-1);

      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_execution_limit_exceeded"
      );
    }
  },
  {
    name: "WorkflowRuntime rejects a node output larger than one megabyte",
    run: async () => {
      const oversizedPlan: CompiledWorkflowPlan = {
        ...plan,
        topologicalOrder: ["oversized"],
        startNodeId: "oversized",
        nodes: {
          oversized: { id: "oversized", type: "oversized", name: "大输出", config: {} }
        },
        outgoingEdges: { oversized: [] }
      };
      const oversizedExecutor: WorkflowNodeExecutor = {
        type: "oversized",
        execute: async () => ({ status: "completed", output: { data: "x".repeat(1024 * 1024) } })
      };
      const events = await collectEvents(
        createRuntime(oversizedPlan, new WorkflowNodeExecutorRegistry([oversizedExecutor]))
      );
      const failed = events.at(-1);

      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_context_too_large"
      );
    }
  },
  {
    name: "WorkflowRuntime stops when accumulated Context exceeds five megabytes",
    run: async () => {
      const nodeIds = Array.from({ length: 7 }, (_, index) => `blob-${index + 1}`);
      const contextPlan: CompiledWorkflowPlan = {
        ...plan,
        topologicalOrder: nodeIds,
        startNodeId: nodeIds[0],
        nodes: Object.fromEntries(
          nodeIds.map((id) => [id, { id, type: "blob", name: id, config: {} }])
        ),
        outgoingEdges: Object.fromEntries(
          nodeIds.map((id, index) => [
            id,
            index < nodeIds.length - 1
              ? [{ id: `edge-${index + 1}`, target: nodeIds[index + 1] }]
              : []
          ])
        )
      };
      const blobExecutor: WorkflowNodeExecutor = {
        type: "blob",
        execute: async ({ node }) => ({
          status: "completed",
          output: { nodeId: node.id, data: "x".repeat(900 * 1024) }
        })
      };
      const events = await collectEvents(
        createRuntime(contextPlan, new WorkflowNodeExecutorRegistry([blobExecutor]))
      );
      const failed = events.at(-1);

      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_context_too_large"
      );
    }
  },
  {
    name: "WorkflowRuntime rejects draft mode before loading a published version",
    run: async () => {
      const events = await collectEvents(createRuntime(plan), {
        ...baseRequest,
        mode: WorkflowRunMode.DRAFT_TEST
      });
      const failed = events.at(-1);

      assert.equal(
        failed?.type === "workflow_failed" ? failed.data.error.type : undefined,
        "workflow_run_mode_unsupported"
      );
    }
  },
  {
    name: "WorkflowRuntime forwards tokens from a streaming node executor",
    run: async () => {
      const streamPlan: CompiledWorkflowPlan = {
        ...plan,
        topologicalOrder: ["stream-end"],
        startNodeId: "stream-end",
        nodes: {
          "stream-end": { id: "stream-end", type: "end", name: "流式结束", config: {} }
        },
        outgoingEdges: { "stream-end": [] }
      };
      const streamingExecutor: WorkflowNodeExecutor = {
        type: "end",
        execute: () =>
          (async function* (): AsyncIterable<NodeExecutionEvent> {
            yield { type: "token", data: { content: "你" } };
            yield { type: "token", data: { content: "好" } };
            yield { type: "result", data: { status: "completed", output: { answer: "你好" } } };
          })()
      };
      const events = await collectEvents(
        createRuntime(streamPlan, new WorkflowNodeExecutorRegistry([streamingExecutor]))
      );

      assert.deepEqual(
        events.filter((event) => event.type === "token").map((event) => event.data.content),
        ["你", "好"]
      );
      assert.equal(events.at(-1)?.type, "workflow_completed");
    }
  }
];
