import * as assert from "node:assert/strict";
import {
  AgentExecutionMode,
  AgentRunSource,
  AgentRunStepType,
  ModelProviderType,
  WorkflowRunMode
} from "@prisma/client";

import { ChatCompletionRequest } from "../model-providers/dto/llm.dto";
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
        {
          runId: "run-1",
          sequence: 1,
          type: AgentRunStepType.RETRIEVAL,
          name: "retrieval",
          input: undefined
        },
        {
          runId: "run-1",
          sequence: 2,
          type: AgentRunStepType.MODEL,
          name: "model",
          input: undefined
        }
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
  },
  {
    name: "AgentRuntimeService rechecks history against the authoritative Agent limit",
    async run(): Promise<void> {
      const modelRequests: ChatCompletionRequest[] = [];
      const runtime = new AgentRuntimeService(
        undefined,
        {
          getAgentRuntimeConfig: async () => ({
            agentId: "agent-1",
            name: "History Agent",
            systemPrompt: "回答问题",
            modelConfigId: "model-1",
            modelName: "qwen",
            providerId: "provider-1",
            providerType: ModelProviderType.OPENAI_COMPATIBLE,
            baseUrl: "https://example.com/v1",
            temperature: 0.7,
            maxTokens: null,
            timeoutSeconds: 120,
            historyTurns: 2,
            executionMode: AgentExecutionMode.AGENT_LOOP,
            workflow: null,
            generationParams: null,
            knowledgeBaseIds: [],
            toolIds: []
          })
        } as never,
        {
          streamChatCompletion: async function* (request: ChatCompletionRequest) {
            modelRequests.push(request);
            yield { type: "token" as const, content: "完成" };
            yield { type: "done" as const };
          }
        } as never,
        {
          getToolDefinitions: async () => [],
          recordToolCallLog: async () => undefined
        } as never
      );

      for await (const _event of runtime.runAgent({
        requestId: "request-history",
        source: AgentRunSource.INTERNAL_CHAT,
        agentId: "agent-1",
        message: { text: "本轮问题" },
        history: [
          { role: "user", content: "问题一" },
          { role: "assistant", content: "回答一" },
          { role: "user", content: "问题二" },
          { role: "assistant", content: "回答二" },
          { role: "user", content: "问题三" },
          { role: "assistant", content: "回答三" }
        ]
      })) {
        // 消费完整 Runtime 流后检查实际交给 Provider 的消息。
      }

      assert.deepEqual(
        modelRequests[0].messages.map((message) =>
          typeof message.content === "string" ? [message.role, message.content] : [message.role]
        ),
        [
          ["system", "回答问题\n\n当前用户问题：\n本轮问题"],
          ["user", "问题二"],
          ["assistant", "回答二"],
          ["user", "问题三"],
          ["assistant", "回答三"],
          ["user", "本轮问题"]
        ]
      );
    }
  },
  {
    name: "AgentRuntimeService dispatches Workflow mode and persists every node event",
    async run(): Promise<void> {
      const runCalls: Array<{ method: string; payload?: unknown }> = [];
      const startedSteps: Array<Record<string, unknown>> = [];
      const completedSteps: Array<{ stepId: string; output: unknown }> = [];
      let workflowRequest: Record<string, unknown> | undefined;
      const runs = {
        createRun: async (payload: unknown) => {
          runCalls.push({ method: "createRun", payload });
          return { runId: "run-workflow", requestId: "request-workflow" };
        },
        startRun: async (_runId: string, modelConfigId?: string) => {
          runCalls.push({ method: "startRun", payload: modelConfigId });
        },
        startStep: async (payload: Record<string, unknown>) => {
          startedSteps.push(payload);
          return { stepId: `step-${String(payload.nodeId)}` };
        },
        completeStep: async (stepId: string, output: unknown) => {
          completedSteps.push({ stepId, output });
        },
        failStep: async () => undefined,
        markFirstToken: async () => runCalls.push({ method: "markFirstToken" }),
        completeRun: async (_runId: string, payload: unknown) =>
          runCalls.push({ method: "completeRun", payload }),
        failRun: async () => undefined,
        cancelRun: async () => undefined
      };
      const agents = {
        getAgentRuntimeConfig: async () => ({
          agentId: "agent-1",
          name: "Workflow Agent",
          systemPrompt: "",
          modelConfigId: "agent-model",
          modelName: "qwen",
          providerId: "provider-1",
          providerType: ModelProviderType.OLLAMA,
          baseUrl: "http://localhost:11434",
          temperature: 0.7,
          maxTokens: null,
          timeoutSeconds: 120,
          historyTurns: 6,
          executionMode: AgentExecutionMode.WORKFLOW,
          workflow: { workflowId: "workflow-1", workflowVersionId: "version-1" },
          generationParams: null,
          knowledgeBaseIds: [],
          toolIds: []
        })
      };
      const workflow = {
        runWorkflow: async function* (request: Record<string, unknown>) {
          workflowRequest = request;
          yield { type: "workflow_started", data: {} };
          yield {
            type: "node_started",
            data: { nodeId: "start", nodeType: "start", name: "开始", attempt: 1 }
          };
          yield {
            type: "node_completed",
            data: { nodeId: "start", nodeType: "start", output: { query: "你好" } }
          };
          yield {
            type: "node_started",
            data: { nodeId: "answer", nodeType: "llm", name: "回答", attempt: 1 }
          };
          yield { type: "token", data: { content: "最终" } };
          yield {
            type: "node_completed",
            data: {
              nodeId: "answer",
              nodeType: "llm",
              nextHandle: "done",
              output: { text: "最终答案" }
            }
          };
          yield {
            type: "workflow_completed",
            data: { answer: "最终答案", output: { answer: "最终答案" } }
          };
        }
      };
      const runtime = new AgentRuntimeService(
        runs as never,
        agents as never,
        undefined,
        undefined,
        undefined,
        undefined,
        workflow as never
      );
      const events = [];

      for await (const event of runtime.runAgent({
        requestId: "request-workflow",
        source: AgentRunSource.INTERNAL_CHAT,
        agentId: "agent-1",
        userId: "user-1",
        message: { text: "你好" },
        history: [{ role: "user", content: "上一轮" }]
      })) {
        events.push(event);
      }

      assert.deepEqual(
        events.map((event) => event.type),
        ["run_started", "token", "run_completed"]
      );
      assert.deepEqual(runCalls[0]?.payload, {
        requestId: "request-workflow",
        source: AgentRunSource.INTERNAL_CHAT,
        agentId: "agent-1",
        userId: "user-1",
        sessionId: undefined,
        externalConversationId: undefined,
        inputPreview: "你好",
        modelConfigId: undefined,
        workflowId: "workflow-1",
        workflowVersionId: "version-1",
        workflowRunMode: WorkflowRunMode.PUBLISHED
      });
      assert.equal(workflowRequest?.runId, "run-workflow");
      assert.equal((workflowRequest?.inputs as Record<string, unknown>).query, "你好");
      assert.deepEqual(
        startedSteps.map((step) => ({
          type: step.type,
          nodeId: step.nodeId,
          sequence: step.sequence
        })),
        [
          { type: AgentRunStepType.WORKFLOW, nodeId: "start", sequence: 1 },
          { type: AgentRunStepType.MODEL, nodeId: "answer", sequence: 2 }
        ]
      );
      assert.deepEqual(completedSteps[1]?.output, {
        nodeType: "llm",
        selectedHandle: "done",
        output: { text: "最终答案" }
      });
      const completed = events.at(-1);
      assert.equal(completed?.type, "run_completed");
      if (completed?.type === "run_completed") assert.equal(completed.data.content, "最终答案");
    }
  },
  {
    name: "AgentRuntimeService records Workflow node failure and preserves retryability",
    async run(): Promise<void> {
      const failedSteps: Array<{ stepId: string; error: unknown }> = [];
      const failedRuns: unknown[] = [];
      const runtime = new AgentRuntimeService(
        {
          createRun: async () => ({ runId: "run-1", requestId: "request-1" }),
          startRun: async () => undefined,
          startStep: async () => ({ stepId: "step-tool" }),
          failStep: async (stepId: string, error: unknown) => failedSteps.push({ stepId, error }),
          failRun: async (_runId: string, error: unknown) => failedRuns.push(error)
        } as never,
        {
          getAgentRuntimeConfig: async () => ({
            agentId: "agent-1",
            modelConfigId: "model-1",
            modelName: "qwen",
            providerType: ModelProviderType.OLLAMA,
            executionMode: AgentExecutionMode.WORKFLOW,
            workflow: { workflowId: "workflow-1", workflowVersionId: "version-1" }
          })
        } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          runWorkflow: async function* () {
            yield {
              type: "node_started",
              data: { nodeId: "tool", nodeType: "tool", name: "HTTP", attempt: 1 }
            };
            yield {
              type: "node_failed",
              data: {
                nodeId: "tool",
                nodeType: "tool",
                error: { type: "workflow_tool_failed", message: "upstream 503", retryable: true }
              }
            };
            yield {
              type: "workflow_failed",
              data: {
                error: { type: "workflow_tool_failed", message: "upstream 503", retryable: true }
              }
            };
          }
        } as never
      );
      const events = [];

      for await (const event of runtime.runAgent({
        requestId: "request-1",
        source: AgentRunSource.SERVICE_API,
        agentId: "agent-1",
        message: { text: "调用接口" },
        history: []
      })) {
        events.push(event);
      }

      assert.deepEqual(failedSteps, [
        {
          stepId: "step-tool",
          error: { type: "workflow_tool_failed", message: "upstream 503" }
        }
      ]);
      assert.deepEqual(failedRuns, [{ type: "workflow_tool_failed", message: "upstream 503" }]);
      const failed = events.at(-1);
      assert.equal(failed?.type, "run_failed");
      if (failed?.type === "run_failed") assert.equal(failed.data.error.retryable, true);
    }
  },
  {
    name: "AgentRuntimeService cancels Workflow traces from runtime terminal events",
    async run(): Promise<void> {
      let canceled = 0;
      const runtime = new AgentRuntimeService(
        {
          createRun: async () => ({ runId: "run-1", requestId: "request-1" }),
          startRun: async () => undefined,
          cancelRun: async () => {
            canceled += 1;
          }
        } as never,
        {
          getAgentRuntimeConfig: async () => ({
            agentId: "agent-1",
            modelConfigId: "model-1",
            modelName: "qwen",
            providerType: ModelProviderType.OLLAMA,
            executionMode: AgentExecutionMode.WORKFLOW,
            workflow: { workflowId: "workflow-1", workflowVersionId: "version-1" }
          })
        } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          runWorkflow: async function* () {
            yield { type: "workflow_canceled", data: { nodeId: "llm" } };
          }
        } as never
      );
      const events = [];

      for await (const event of runtime.runAgent({
        requestId: "request-1",
        source: AgentRunSource.PUBLIC_WIDGET,
        agentId: "agent-1",
        message: { text: "停止" },
        history: []
      })) {
        events.push(event);
      }

      assert.equal(canceled, 1);
      assert.deepEqual(
        events.map((event) => event.type),
        ["run_started", "run_canceled"]
      );
    }
  }
];
