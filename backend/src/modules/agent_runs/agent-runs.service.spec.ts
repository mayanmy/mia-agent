import * as assert from "node:assert/strict";
import {
  AgentRunSource,
  AgentRunStatus,
  AgentRunStepStatus,
  AgentRunStepType
} from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentRunsService } from "./agent-runs.service";
import { AgentRunsController } from "./agent-runs.controller";

export const tests = [
  {
    name: "AgentRunsController restricts Run Trace APIs to administrators",
    run: () => {
      assert.deepEqual(Reflect.getMetadata("mia:roles", AgentRunsController), ["ADMIN"]);
    }
  },
  {
    name: "AgentRunsService lists filtered Runs with pagination and step counts",
    run: async () => {
      let findQuery: Record<string, unknown> | undefined;
      const createdAt = new Date("2026-07-22T08:00:00.000Z");
      const run = {
        id: "run-1",
        requestId: "request-1",
        source: AgentRunSource.INTERNAL_CHAT,
        status: AgentRunStatus.COMPLETED,
        agentId: "agent-1",
        userId: "user-1",
        sessionId: null,
        externalConversationId: null,
        modelConfigId: "model-1",
        inputPreview: "hello",
        outputPreview: "world",
        inputTokens: 2,
        outputTokens: 3,
        estimatedCost: null,
        firstTokenAt: createdAt,
        startedAt: createdAt,
        finishedAt: createdAt,
        errorType: null,
        errorMessage: null,
        createdAt,
        updatedAt: createdAt,
        _count: { steps: 2 }
      };
      const prisma = {
        agentRun: {
          findMany: async (query: Record<string, unknown>) => {
            findQuery = query;
            return [run];
          },
          count: async () => 1
        }
      };
      const result = await new AgentRunsService(prisma as never).listRuns({
        page: "2",
        pageSize: "10",
        status: AgentRunStatus.COMPLETED,
        agentId: " agent-1 ",
        createdFrom: "2026-07-01T00:00:00.000Z"
      });

      assert.equal(result.page, 2);
      assert.equal(result.list[0].stepCount, 2);
      assert.equal(findQuery?.skip, 10);
      assert.deepEqual(findQuery?.where, {
        agentId: "agent-1",
        status: AgentRunStatus.COMPLETED,
        createdAt: { gte: new Date("2026-07-01T00:00:00.000Z") }
      });
    }
  },
  {
    name: "AgentRunsService returns ordered Run detail and rejects missing Runs",
    run: async () => {
      const createdAt = new Date("2026-07-22T08:00:00.000Z");
      const prisma = {
        agentRun: {
          findUnique: async ({ where }: { where: { id: string } }) =>
            where.id === "missing"
              ? null
              : {
                  id: "run-1",
                  requestId: "request-1",
                  source: AgentRunSource.SERVICE_API,
                  status: AgentRunStatus.FAILED,
                  agentId: "agent-1",
                  userId: null,
                  sessionId: null,
                  externalConversationId: "conversation-1",
                  modelConfigId: "model-1",
                  inputPreview: "hello",
                  outputPreview: null,
                  inputTokens: null,
                  outputTokens: null,
                  estimatedCost: null,
                  firstTokenAt: null,
                  startedAt: createdAt,
                  finishedAt: createdAt,
                  errorType: "model_timeout",
                  errorMessage: "timeout",
                  createdAt,
                  updatedAt: createdAt,
                  steps: [
                    {
                      id: "step-1",
                      sequence: 1,
                      type: AgentRunStepType.MODEL,
                      name: "chat_stream",
                      status: AgentRunStepStatus.FAILED,
                      input: null,
                      output: null,
                      elapsedMs: 20,
                      errorType: "model_timeout",
                      errorMessage: "timeout",
                      startedAt: createdAt,
                      finishedAt: createdAt
                    }
                  ]
                }
        }
      };
      const service = new AgentRunsService(prisma as never);
      const detail = await service.getRunDetail("run-1");
      assert.equal(detail.steps[0].sequence, 1);
      assert.equal(detail.externalConversationId, "conversation-1");
      await assert.rejects(
        () => service.getRunDetail("missing"),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agentRun.notFound);
          assert.equal(error.httpStatus, 404);
          return true;
        }
      );
    }
  },
  {
    name: "AgentRunsService reports cleanup counts and validates retention",
    run: async () => {
      const prisma = { $queryRaw: async () => [{ deleted_runs: 4n, deleted_tool_logs: 7n }] };
      const service = new AgentRunsService(prisma as never);
      const result = await service.cleanupExpiredRuns(90, 180);
      assert.equal(result.deletedRuns, 4);
      assert.equal(result.deletedToolCallLogs, 7);
      await assert.rejects(() => service.cleanupExpiredRuns(0, 180), /completedRetentionDays/u);
    }
  },
  {
    name: "AgentRunsService.createRun normalizes identifiers and truncates input preview",
    run: async () => {
      let createdData: Record<string, unknown> | undefined;
      const prisma = {
        agentRun: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdData = data;
            return {
              id: "run-1",
              requestId: data.requestId,
              status: AgentRunStatus.QUEUED
            };
          }
        }
      };
      const service = new AgentRunsService(prisma as never);

      const result = await service.createRun({
        requestId: "  request-1  ",
        source: AgentRunSource.INTERNAL_CHAT,
        agentId: "  agent-1  ",
        inputPreview: "x".repeat(2_100)
      });

      assert.deepEqual(result, {
        runId: "run-1",
        requestId: "request-1",
        status: AgentRunStatus.QUEUED
      });
      assert.equal(createdData?.agentId, "agent-1");
      assert.equal(typeof createdData?.inputPreview, "string");
      assert.ok(String(createdData?.inputPreview).endsWith("...[truncated]"));
    }
  },
  {
    name: "AgentRunsService completes a running Run and settles active Steps transactionally",
    run: async () => {
      const runUpdates: Array<Record<string, unknown>> = [];
      const stepUpdates: Array<Record<string, unknown>> = [];
      const transaction = {
        agentRun: {
          updateMany: async (query: Record<string, unknown>) => {
            runUpdates.push(query);
            return { count: 1 };
          }
        },
        agentRunStep: {
          updateMany: async (query: Record<string, unknown>) => {
            stepUpdates.push(query);
            return { count: 2 };
          }
        }
      };
      const prisma = {
        agentRun: {
          updateMany: transaction.agentRun.updateMany
        },
        $transaction: async (callback: (client: typeof transaction) => Promise<void>) =>
          callback(transaction)
      };
      const service = new AgentRunsService(prisma as never);

      await service.startRun("run-1", "model-1");
      await service.completeRun("run-1", {
        outputPreview: "done",
        inputTokens: 12,
        outputTokens: 8,
        estimatedCost: 0.002
      });

      assert.equal(runUpdates.length, 2);
      assert.deepEqual(runUpdates[0].where, {
        id: "run-1",
        status: AgentRunStatus.QUEUED
      });
      assert.equal(
        (runUpdates[1].data as Record<string, unknown>).status,
        AgentRunStatus.COMPLETED
      );
      assert.equal(stepUpdates.length, 1);
      assert.equal(
        (stepUpdates[0].data as Record<string, unknown>).status,
        AgentRunStepStatus.SKIPPED
      );
    }
  },
  {
    name: "AgentRunsService rejects invalid Run state transitions",
    run: async () => {
      const prisma = {
        agentRun: {
          updateMany: async () => ({ count: 0 })
        }
      };
      const service = new AgentRunsService(prisma as never);

      await assert.rejects(
        () => service.startRun("run-1"),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agentRun.invalidState);
          assert.equal(error.httpStatus, 409);
          return true;
        }
      );
    }
  },
  {
    name: "AgentRunsService redacts sensitive Step input and completes the Step",
    run: async () => {
      let createdInput: unknown;
      let completedData: Record<string, unknown> | undefined;
      const startedAt = new Date(Date.now() - 25);
      const transaction = {
        agentRun: {
          findFirst: async () => ({ id: "run-1" })
        },
        agentRunStep: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdInput = data.input;
            return {
              id: "step-1",
              runId: "run-1",
              sequence: 1,
              startedAt
            };
          },
          findFirst: async () => ({ startedAt }),
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            completedData = data;
            return { count: 1 };
          }
        }
      };
      const prisma = {
        $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
          callback(transaction)
      };
      const service = new AgentRunsService(prisma as never);

      const step = await service.startStep({
        runId: "run-1",
        sequence: 1,
        type: AgentRunStepType.TOOL,
        name: "http_request",
        input: {
          url: "https://example.com",
          authorization: "Bearer private",
          nested: {
            apiKey: "private-key",
            dataUrl: "data:image/png;base64,private"
          }
        }
      });
      await service.completeStep(step.stepId, {
        ok: true,
        token: "private-token"
      });

      assert.deepEqual(createdInput, {
        url: "https://example.com",
        authorization: "[REDACTED]",
        nested: {
          apiKey: "[REDACTED]",
          dataUrl: "[REDACTED]"
        }
      });
      assert.equal(completedData?.status, AgentRunStepStatus.COMPLETED);
      assert.deepEqual(completedData?.output, {
        ok: true,
        token: "[REDACTED]"
      });
      assert.ok(Number(completedData?.elapsedMs) >= 0);
    }
  },
  {
    name: "AgentRunsService rejects Steps for Runs that are not running",
    run: async () => {
      const transaction = {
        agentRun: {
          findFirst: async () => null
        },
        agentRunStep: {
          create: async () => {
            throw new Error("Step should not be created");
          }
        }
      };
      const prisma = {
        $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
          callback(transaction)
      };
      const service = new AgentRunsService(prisma as never);

      await assert.rejects(
        () =>
          service.startStep({
            runId: "run-1",
            sequence: 1,
            type: AgentRunStepType.MODEL,
            name: "chat_completion"
          }),
        (error) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, ErrorCodes.agentRun.invalidState);
          return true;
        }
      );
    }
  }
];
