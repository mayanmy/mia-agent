import * as assert from "node:assert/strict";
import { EvaluationDatasetVersionStatus } from "@prisma/client";

import { runInWorkspaceContext } from "../../core/auth/workspace-context";
import { EvaluationsService } from "./evaluations.service";

const draftVersion = {
  id: "00000000-0000-4000-8000-000000000101",
  datasetId: "00000000-0000-4000-8000-000000000102",
  version: 1,
  status: EvaluationDatasetVersionStatus.DRAFT,
  revision: 1,
  caseCount: 0,
  createdByUserId: "00000000-0000-4000-8000-000000000010",
  frozenAt: null,
  createdAt: new Date("2026-09-22T00:00:00Z"),
  updatedAt: new Date("2026-09-22T00:00:00Z")
};

export const tests = [
  {
    name: "EvaluationsService creates a case and increments draft counters atomically",
    run: async () => {
      let createdData: Record<string, unknown> | undefined;
      let versionUpdate: Record<string, unknown> | undefined;
      const transaction = {
        evaluationCase: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdData = data;
            return { id: "case-id", ...data };
          }
        },
        evaluationDatasetVersion: {
          update: async (query: Record<string, unknown>) => {
            versionUpdate = query;
          }
        }
      };
      const prisma = {
        evaluationDatasetVersion: { findFirst: async () => draftVersion },
        $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      };
      const service = new EvaluationsService(prisma as never);

      const item = await service.createCase(
        draftVersion.id,
        { question: "  员工出差标准是什么？  ", answerable: true },
        "00000000-0000-4000-8000-000000000010"
      );

      assert.equal(item.question, "员工出差标准是什么？");
      assert.equal(typeof createdData?.questionHash, "string");
      assert.deepEqual(versionUpdate, {
        where: { id: draftVersion.id },
        data: { caseCount: { increment: 1 }, revision: { increment: 1 } }
      });
    }
  },
  {
    name: "EvaluationsService refuses to freeze an empty draft",
    run: async () => {
      const prisma = {
        evaluationDatasetVersion: { findFirst: async () => draftVersion }
      };
      const service = new EvaluationsService(prisma as never);

      await assert.rejects(
        () => service.freezeVersion(draftVersion.id, { expectedRevision: 1 }),
        /empty dataset version cannot be frozen/u
      );
    }
  },
  {
    name: "EvaluationsService rejects writes to a frozen version",
    run: async () => {
      const prisma = {
        evaluationDatasetVersion: {
          findFirst: async () => ({
            ...draftVersion,
            status: EvaluationDatasetVersionStatus.FROZEN
          })
        }
      };
      const service = new EvaluationsService(prisma as never);

      await assert.rejects(
        () =>
          service.createCase(
            draftVersion.id,
            { question: "不可修改" },
            "00000000-0000-4000-8000-000000000010"
          ),
        /frozen dataset version cannot be modified/u
      );
    }
  },
  {
    name: "EvaluationsService creates a pending run with a secret-free immutable snapshot",
    run: async () => {
      let runData: Record<string, unknown> | undefined;
      let outboxRunId: string | undefined;
      let dispatched = false;
      const transaction = {
        evaluationRun: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            runData = data;
            return {
              id: "run-id",
              status: "PENDING",
              totalCases: 1,
              createdAt: new Date(),
              ...data
            };
          }
        },
        evaluationCaseResult: { createMany: async () => ({ count: 1 }) },
        evaluationJob: {
          create: async ({ data }: { data: { runId: string } }) => {
            outboxRunId = data.runId;
          }
        }
      };
      const prisma = {
        evaluationDatasetVersion: {
          findFirst: async () => ({
            ...draftVersion,
            status: EvaluationDatasetVersionStatus.FROZEN,
            dataset: { status: "ACTIVE" },
            cases: [{ id: "case-id" }]
          })
        },
        $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      };
      const agents = {
        createAgentVersion: async () => ({ id: "agent-version-id" }),
        getVersionRuntimeConfig: async () => ({
          agentId: "agent-id",
          name: "制度助手",
          systemPrompt: "仅按制度回答",
          modelConfigId: "model-id",
          modelName: "model",
          providerId: "provider-id",
          providerType: "OPENAI_COMPATIBLE",
          baseUrl: "https://secret.internal",
          temperature: 0.2,
          maxTokens: 1000,
          timeoutSeconds: 60,
          thinkingMode: "AUTO",
          knowledgeBaseIds: ["kb-id"]
        })
      };
      const queue = {
        dispatchPending: async () => {
          dispatched = true;
        }
      };
      const service = new EvaluationsService(prisma as never, agents as never, queue as never);

      await runInWorkspaceContext("workspace-id", undefined, () =>
        service.createRun(
          {
            datasetVersionId: draftVersion.id,
            agentId: "agent-id"
          },
          "user-id"
        )
      );

      assert.equal(outboxRunId, "run-id");
      assert.equal(dispatched, true);
      assert.equal(JSON.stringify(runData).includes("secret.internal"), false);
      assert.equal((runData?.retrievalConfigSnapshot as { topK: number }).topK, 5);
    }
  },
  {
    name: "EvaluationsService reports incompatible dataset versions before comparison",
    run: async () => {
      const prisma = {
        evaluationRun: {
          findFirst: async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            workspaceId: "workspace-id",
            datasetVersionId: where.id === "baseline" ? "version-a" : "version-b",
            metricsVersion: "v1",
            status: "COMPLETED"
          })
        }
      };
      const service = new EvaluationsService(prisma as never);
      const result = await runInWorkspaceContext("workspace-id", undefined, () =>
        service.getComparisonCompatibility({
          baselineRunId: "baseline",
          candidateRunId: "candidate"
        })
      );
      assert.equal(result.compatible, false);
      assert.equal(result.reasons[0]?.field, "datasetVersionId");
    }
  }
];
