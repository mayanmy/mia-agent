import * as assert from "node:assert/strict";

import { CompiledWorkflowNode, CompiledWorkflowPlan } from "../workflows/dto/compiled-plan.dto";
import { NodeExecutionEvent } from "./dto/node-execution.dto";
import { LlmNodeExecutor } from "./executors/llm.executor";
import { RetrievalNodeExecutor } from "./executors/retrieval.executor";
import { ToolNodeExecutor } from "./executors/tool.executor";
import { WorkflowExpressionResolver } from "./expression-resolver";
import { WorkflowNodeExecutorRegistry } from "./node-executor.registry";
import { createWorkflowContext } from "./workflow-context";
import { WorkflowRuntimeError } from "./workflow-runtime.error";
import { WorkflowRuntimeService } from "./workflow-runtime.service";
import { WorkflowRunMode } from "@prisma/client";

const resolver = new WorkflowExpressionResolver();

function createContext() {
  return createWorkflowContext({
    requestId: "request-1",
    runId: "run-1",
    agentId: "agent-1",
    userId: "user-1",
    inputs: { query: "Mia 是什么？", city: "深圳" }
  });
}

async function collectNodeEvents(
  source: AsyncIterable<NodeExecutionEvent>
): Promise<NodeExecutionEvent[]> {
  const events: NodeExecutionEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

export const tests = [
  {
    name: "LlmNodeExecutor streams tokens and parses JSON object output",
    run: async () => {
      let providerSignal: AbortSignal | undefined;
      const executor = new LlmNodeExecutor(
        {
          streamChatCompletion: async function* (request: { signal?: AbortSignal }) {
            providerSignal = request.signal;
            yield { type: "token", content: '{"answer":' };
            yield { type: "token", content: '"Mia"}' };
            yield { type: "done" };
          }
        } as never,
        resolver
      );
      const signal = new AbortController().signal;
      const node: CompiledWorkflowNode = {
        id: "llm",
        type: "llm",
        name: "模型",
        config: {
          modelConfigId: "model-1",
          prompt: {
            kind: "template",
            segments: ["问题：", { kind: "reference", source: "input", path: ["query"] }]
          },
          responseFormat: "json_object"
        }
      };

      const events = await collectNodeEvents(
        executor.execute({ node, context: createContext(), signal })
      );
      const result = events.find((event) => event.type === "result");

      assert.equal(providerSignal, signal);
      assert.deepEqual(
        events.filter((event) => event.type === "token").map((event) => event.data.content),
        ['{"answer":', '"Mia"}']
      );
      assert.deepEqual(result?.data.output.structured, { answer: "Mia" });
    }
  },
  {
    name: "WorkflowExpressionResolver keeps legacy body references compatible with public outputs",
    run: () => {
      const context = createContext();
      context.nodes.currentTool = { output: { result: { weather: "sunny" } } };
      context.nodes.legacyTool = { output: { body: { weather: "cloudy" } } };

      assert.deepEqual(
        resolver.resolve(
          {
            kind: "reference",
            source: "nodes",
            path: ["currentTool", "output", "body"]
          },
          context
        ),
        { weather: "sunny" }
      );
      assert.deepEqual(
        resolver.resolve(
          {
            kind: "reference",
            source: "nodes",
            path: ["legacyTool", "output", "result"]
          },
          context
        ),
        { weather: "cloudy" }
      );
    }
  },
  {
    name: "LlmNodeExecutor rejects invalid JSON object output",
    run: async () => {
      const executor = new LlmNodeExecutor(
        {
          streamChatCompletion: async function* () {
            yield { type: "token", content: "not json" };
          }
        } as never,
        resolver
      );
      const node: CompiledWorkflowNode = {
        id: "llm",
        type: "llm",
        name: "模型",
        config: { modelConfigId: "model-1", prompt: "hello", responseFormat: "json_object" }
      };

      await assert.rejects(
        () => collectNodeEvents(executor.execute({ node, context: createContext() })),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowRuntimeError);
          assert.equal(error.type, "workflow_output_invalid");
          return true;
        }
      );
    }
  },
  {
    name: "RetrievalNodeExecutor resolves query and returns chunks with source summaries",
    run: async () => {
      let retrievalRequest: Record<string, unknown> | undefined;
      const executor = new RetrievalNodeExecutor(
        {
          retrieveKnowledgeContext: async (request: Record<string, unknown>) => {
            retrievalRequest = request;
            return {
              query: request.query,
              elapsedMs: 12,
              sources: [
                {
                  knowledgeBaseId: "kb-1",
                  documentId: "doc-1",
                  documentName: "manual.md",
                  chunkId: "chunk-1",
                  chunkIndex: 0,
                  content: "Mia 是内部 Agent 平台",
                  score: 0.92
                }
              ]
            };
          }
        } as never,
        resolver
      );
      const signal = new AbortController().signal;
      const node: CompiledWorkflowNode = {
        id: "retrieval",
        type: "retrieval",
        name: "检索",
        config: {
          knowledgeBaseIds: ["kb-1"],
          query: { kind: "reference", source: "input", path: ["query"] },
          topK: 3,
          scoreThreshold: 0.7
        }
      };

      const result = await executor.execute({ node, context: createContext(), signal });

      assert.equal(retrievalRequest?.query, "Mia 是什么？");
      assert.equal(retrievalRequest?.signal, signal);
      assert.equal((result.output.chunks as unknown[]).length, 1);
      assert.equal((result.output.sources as Array<Record<string, unknown>>)[0].content, undefined);
    }
  },
  {
    name: "ToolNodeExecutor resolves arguments and reuses ToolsService execution context",
    run: async () => {
      let toolRequest: Record<string, unknown> | undefined;
      const executor = new ToolNodeExecutor(
        {
          executeTool: async (request: Record<string, unknown>) => {
            toolRequest = request;
            return { toolId: request.toolId, ok: true, output: { weather: "sunny" }, elapsedMs: 8 };
          }
        } as never,
        resolver
      );
      const signal = new AbortController().signal;
      const node: CompiledWorkflowNode = {
        id: "tool",
        type: "tool",
        name: "天气工具",
        config: {
          toolId: "http_weather",
          arguments: {
            city: { kind: "reference", source: "input", path: ["city"] }
          }
        }
      };

      const result = await executor.execute({ node, context: createContext(), signal });

      assert.deepEqual(toolRequest?.input, { city: "深圳" });
      assert.equal(toolRequest?.requestId, "request-1");
      assert.equal(toolRequest?.runId, "run-1");
      assert.equal(toolRequest?.signal, signal);
      assert.deepEqual(result.output.result, { weather: "sunny" });
    }
  },
  {
    name: "ToolNodeExecutor supports continue and fail policies without retrying",
    run: async () => {
      let calls = 0;
      const executor = new ToolNodeExecutor(
        {
          executeTool: async () => {
            calls += 1;
            return {
              toolId: "http_weather",
              ok: false,
              errorType: "http_503",
              errorMessage: "upstream unavailable",
              elapsedMs: 5
            };
          }
        } as never,
        resolver
      );
      const baseNode: CompiledWorkflowNode = {
        id: "tool",
        type: "tool",
        name: "天气工具",
        config: { toolId: "http_weather", arguments: {} }
      };
      const continued = await executor.execute({
        node: { ...baseNode, config: { ...baseNode.config, failurePolicy: "continue" } },
        context: createContext()
      });
      assert.equal(continued.status, "completed");
      assert.equal(continued.output.ok, false);

      await assert.rejects(
        () => executor.execute({ node: baseNode, context: createContext() }),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowRuntimeError);
          assert.equal(error.type, "workflow_tool_failed");
          return true;
        }
      );
      assert.equal(calls, 2);
    }
  },
  {
    name: "ToolNodeExecutor never continues after cancellation",
    run: async () => {
      const executor = new ToolNodeExecutor(
        {
          executeTool: async () => ({
            toolId: "http_weather",
            ok: false,
            errorType: "canceled",
            errorMessage: "工具调用超时或已取消",
            elapsedMs: 1
          })
        } as never,
        resolver
      );
      const controller = new AbortController();
      controller.abort();
      const node: CompiledWorkflowNode = {
        id: "tool",
        type: "tool",
        name: "天气工具",
        config: { toolId: "http_weather", arguments: {}, failurePolicy: "continue" }
      };

      await assert.rejects(
        () => executor.execute({ node, context: createContext(), signal: controller.signal }),
        (error: unknown) => {
          assert.ok(error instanceof WorkflowRuntimeError);
          assert.equal(error.type, "workflow_canceled");
          return true;
        }
      );
    }
  },
  {
    name: "WorkflowRuntime runs Retrieval then streaming LLM then End",
    run: async () => {
      const retrieval = new RetrievalNodeExecutor(
        {
          retrieveKnowledgeContext: async () => ({
            query: "Mia 是什么？",
            elapsedMs: 3,
            sources: [
              {
                knowledgeBaseId: "kb-1",
                documentId: "doc-1",
                documentName: "manual.md",
                chunkId: "chunk-1",
                chunkIndex: 0,
                content: "Mia 是 Agent 平台",
                score: 0.9
              }
            ]
          })
        } as never,
        resolver
      );
      const llm = new LlmNodeExecutor(
        {
          streamChatCompletion: async function* () {
            yield { type: "token", content: "Mia 是 Agent 平台" };
          }
        } as never,
        resolver
      );
      const end = {
        type: "end",
        execute: async () => ({
          status: "completed" as const,
          output: { answer: "Mia 是 Agent 平台" }
        })
      };
      const runtimePlan: CompiledWorkflowPlan = {
        schemaVersion: 1,
        startNodeId: "retrieval",
        topologicalOrder: ["retrieval", "llm", "end"],
        nodes: {
          retrieval: {
            id: "retrieval",
            type: "retrieval",
            name: "检索",
            config: { knowledgeBaseIds: ["kb-1"], query: "Mia 是什么？" }
          },
          llm: {
            id: "llm",
            type: "llm",
            name: "模型",
            config: {
              modelConfigId: "model-1",
              prompt: {
                kind: "template",
                segments: [
                  "资料：",
                  { kind: "reference", source: "nodes", path: ["retrieval", "output", "chunks"] }
                ]
              }
            }
          },
          end: { id: "end", type: "end", name: "结束", config: {} }
        },
        outgoingEdges: {
          retrieval: [{ id: "e1", target: "llm" }],
          llm: [{ id: "e2", target: "end" }],
          end: []
        },
        requiredInputs: [],
        resourceFingerprints: {}
      };
      const runtime = new WorkflowRuntimeService(
        {
          getPublishedRuntimeConfig: async () => ({
            workflowId: "workflow-1",
            workflowVersionId: "version-1",
            version: 1,
            graphSchemaVersion: 1,
            checksum: "checksum",
            compiledPlan: runtimePlan as unknown as Record<string, unknown>
          })
        } as never,
        new WorkflowNodeExecutorRegistry([retrieval, llm, end])
      );
      const events = [];
      for await (const event of runtime.runWorkflow({
        requestId: "request-1",
        agentId: "agent-1",
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        mode: WorkflowRunMode.PUBLISHED,
        inputs: {}
      })) {
        events.push(event);
      }

      assert.ok(events.some((event) => event.type === "token"));
      assert.equal(events.at(-1)?.type, "workflow_completed");
    }
  }
];
