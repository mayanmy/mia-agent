import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { runInWorkspaceContext } from "../core/auth/workspace-context";
import { ModelProvidersService } from "../modules/model-providers/model-providers.service";
import { PrismaService } from "../modules/prisma/prisma.service";
import { RetrievalService } from "../modules/retrieval/retrieval.service";
import { calculateRetrievalMetrics } from "../modules/evaluations/metrics/retrieval.metrics";
import { LlmEvaluationGrader } from "../modules/evaluations/graders/llm.grader";

type RetrievalSnapshot = { knowledgeBaseIds: string[]; topK: number; scoreThreshold?: number };
type AgentSnapshot = {
  systemPrompt: string;
  modelConfigId: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  thinkingMode: "AUTO" | "ENABLED" | "DISABLED";
};
type PricingSnapshot = {
  inputTokenPricePerMillion: string | null;
  outputTokenPricePerMillion: string | null;
  priceCurrency: string;
};
type GraderSnapshot = PricingSnapshot & {
  enabled: boolean;
  modelConfigId?: string;
  promptVersion: string;
};
type UsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  evaluatedCostMicros: number;
  graderCostMicros: number;
  currencies: Set<string>;
};

@Injectable()
export class RagEvaluationJob {
  private readonly logger = new Logger(RagEvaluationJob.name);
  private readonly activeRuns = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrievalService: RetrievalService,
    private readonly modelProvidersService: ModelProvidersService,
    private readonly grader: LlmEvaluationGrader
  ) {}

  cancel(runId: string): void {
    this.abortControllers.get(runId)?.abort();
  }

  async execute(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) return;
    this.activeRuns.add(runId);
    const controller = new AbortController();
    this.abortControllers.set(runId, controller);
    try {
      const run = await this.prisma.evaluationRun.findUnique({ where: { id: runId } });
      if (!run || !["PENDING", "RUNNING"].includes(run.status)) return;
      await runInWorkspaceContext(run.workspaceId, undefined, () =>
        this.processRun(runId, controller)
      );
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.logger.error(`evaluation run failed: run=${runId} error=${message}`);
      await this.prisma.evaluationRun.updateMany({
        where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
        data: {
          status: "FAILED",
          errorType: "RUN_FAILED",
          errorMessage: message,
          finishedAt: new Date()
        }
      });
    } finally {
      await this.prisma.evaluationJob.updateMany({
        where: { runId },
        data: { dispatchStatus: "COMPLETED" }
      });
      this.abortControllers.delete(runId);
      this.activeRuns.delete(runId);
    }
  }

  private async processRun(runId: string, controller: AbortController): Promise<void> {
    await this.prisma.evaluationRun.updateMany({
      where: { id: runId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        heartbeatAt: new Date(),
        errorType: null,
        errorMessage: null
      }
    });
    const run = await this.prisma.evaluationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { datasetVersion: { include: { cases: { orderBy: { createdAt: "asc" } } } } }
    });
    const agent = run.agentConfigSnapshot as unknown as AgentSnapshot;
    const retrieval = run.retrievalConfigSnapshot as unknown as RetrievalSnapshot;
    const model = run.modelConfigSnapshot as unknown as PricingSnapshot;
    const grader = run.graderConfigSnapshot as unknown as GraderSnapshot;

    for (const evaluationCase of run.datasetVersion.cases) {
      const latest = await this.prisma.evaluationRun.findUniqueOrThrow({
        where: { id: runId },
        select: { cancelRequestedAt: true }
      });
      if (latest.cancelRequestedAt || controller.signal.aborted) {
        await this.finishCanceled(runId);
        return;
      }
      const existing = await this.prisma.evaluationCaseResult.findUnique({
        where: { runId_caseId: { runId, caseId: evaluationCase.id } }
      });
      if (existing?.status === "COMPLETED" || existing?.status === "FAILED") continue;
      await this.executeCase(
        runId,
        evaluationCase,
        agent,
        retrieval,
        model,
        grader,
        controller.signal
      );
    }
    await this.aggregateAndComplete(runId);
  }

  private async executeCase(
    runId: string,
    evaluationCase: {
      id: string;
      question: string;
      expectedAnswer: string | null;
      answerable: boolean;
      expectedDocumentIds: string[];
      expectedChunkIds: string[];
    },
    agent: AgentSnapshot,
    retrieval: RetrievalSnapshot,
    model: PricingSnapshot,
    graderSnapshot: GraderSnapshot,
    signal: AbortSignal
  ): Promise<void> {
    const startedAt = Date.now();
    await this.prisma.evaluationCaseResult.upsert({
      where: { runId_caseId: { runId, caseId: evaluationCase.id } },
      create: {
        runId,
        caseId: evaluationCase.id,
        status: "RUNNING",
        attempt: 1,
        startedAt: new Date()
      },
      update: {
        status: "RUNNING",
        attempt: { increment: 1 },
        startedAt: new Date(),
        errorType: null,
        errorMessage: null
      }
    });
    try {
      const context = await this.retrievalService.retrieveKnowledgeContext({
        query: evaluationCase.question,
        knowledgeBaseIds: retrieval.knowledgeBaseIds,
        topK: retrieval.topK,
        scoreThreshold: retrieval.scoreThreshold,
        signal
      });
      const retrievalMetrics = calculateRetrievalMetrics(
        context.sources,
        evaluationCase.expectedDocumentIds,
        evaluationCase.expectedChunkIds
      );
      const response = await this.modelProvidersService.createChatCompletion({
        modelConfigId: agent.modelConfigId,
        messages: [
          { role: "system", content: agent.systemPrompt },
          {
            role: "user",
            content: this.buildEvaluationPrompt(evaluationCase.question, context.sources)
          }
        ],
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        timeoutSeconds: agent.timeoutSeconds,
        thinkingMode: agent.thinkingMode,
        purpose: "evaluation_answer",
        signal
      });
      const judge =
        graderSnapshot.enabled && graderSnapshot.modelConfigId
          ? await this.grader.grade({
              modelConfigId: graderSnapshot.modelConfigId,
              question: evaluationCase.question,
              expectedAnswer: evaluationCase.expectedAnswer,
              answerable: evaluationCase.answerable,
              actualAnswer: response.content,
              contexts: context.sources,
              signal
            })
          : { metrics: null, usage: null, warning: null };
      const agentUsage = this.buildUsage(response.usage, model);
      const graderUsage = this.buildUsage(judge.usage, graderSnapshot);
      const currencies = [agentUsage?.currency, graderUsage?.currency].filter(Boolean);
      const currency =
        currencies.length && currencies.every((item) => item === currencies[0])
          ? currencies[0]
          : null;
      const estimatedCostMicros = currency
        ? (agentUsage?.costMicros ?? 0) + (graderUsage?.costMicros ?? 0)
        : null;
      await this.prisma.$transaction([
        this.prisma.evaluationCaseResult.update({
          where: { runId_caseId: { runId, caseId: evaluationCase.id } },
          data: {
            status: "COMPLETED",
            actualAnswer: response.content,
            retrievedChunks: context.sources as unknown as Prisma.InputJsonValue,
            retrievalMetrics: retrievalMetrics as unknown as Prisma.InputJsonValue,
            answerMetrics: judge.metrics
              ? {
                  correctness: judge.metrics.correctness.score,
                  faithfulness: judge.metrics.faithfulness.score,
                  relevance: judge.metrics.relevance.score
                }
              : Prisma.JsonNull,
            graderDetails: graderSnapshot.enabled
              ? {
                  promptVersion: graderSnapshot.promptVersion,
                  metrics: judge.metrics,
                  warning: judge.warning
                }
              : Prisma.JsonNull,
            runtimeMetrics: {
              retrievalMs: context.elapsedMs,
              totalMs: Date.now() - startedAt,
              promptTokens: response.usage?.promptTokens ?? null,
              completionTokens: response.usage?.completionTokens ?? null,
              totalTokens: response.usage?.totalTokens ?? null,
              agentUsage,
              graderUsage,
              estimatedCostMicros,
              currency,
              metricsVersion: "v2"
            },
            finishedAt: new Date()
          }
        }),
        this.prisma.evaluationRun.update({
          where: { id: runId },
          data: { completedCases: { increment: 1 }, heartbeatAt: new Date() }
        })
      ]);
    } catch (error) {
      if (signal.aborted) return;
      await this.prisma.$transaction([
        this.prisma.evaluationCaseResult.update({
          where: { runId_caseId: { runId, caseId: evaluationCase.id } },
          data: {
            status: "FAILED",
            errorType: "CASE_FAILED",
            errorMessage: this.safeErrorMessage(error),
            finishedAt: new Date()
          }
        }),
        this.prisma.evaluationRun.update({
          where: { id: runId },
          data: { failedCases: { increment: 1 }, heartbeatAt: new Date() }
        })
      ]);
    }
  }

  private async aggregateAndComplete(runId: string): Promise<void> {
    const results = await this.prisma.evaluationCaseResult.findMany({ where: { runId } });
    const completed = results.filter((item) => item.status === "COMPLETED");
    const retrievalMetrics = completed.map(
      (item) => item.retrievalMetrics as Record<string, unknown> | null
    );
    const runtimeMetrics = completed.map(
      (item) => item.runtimeMetrics as Record<string, unknown> | null
    );
    const answerMetrics = completed.map(
      (item) => item.answerMetrics as Record<string, unknown> | null
    );
    const totals = runtimeMetrics.reduce<UsageTotals>(
      (result, item) => {
        const agentUsage = this.record(item?.agentUsage);
        const graderUsage = this.record(item?.graderUsage);
        result.promptTokens +=
          this.number(agentUsage?.inputTokens) + this.number(graderUsage?.inputTokens);
        result.completionTokens +=
          this.number(agentUsage?.outputTokens) + this.number(graderUsage?.outputTokens);
        result.totalTokens +=
          this.number(agentUsage?.totalTokens) + this.number(graderUsage?.totalTokens);
        result.evaluatedCostMicros += this.number(agentUsage?.costMicros);
        result.graderCostMicros += this.number(graderUsage?.costMicros);
        const itemCurrency = typeof item?.currency === "string" ? item.currency : null;
        if (itemCurrency) result.currencies.add(itemCurrency);
        return result;
      },
      {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        evaluatedCostMicros: 0,
        graderCostMicros: 0,
        currencies: new Set<string>()
      }
    );
    const currency = totals.currencies.size === 1 ? [...totals.currencies][0] : null;
    const summary = {
      retrieval: {
        hitRateAt5: this.average(retrievalMetrics, "hitRateAt5"),
        recallAt5: this.average(retrievalMetrics, "recallAt5"),
        mrr: this.average(retrievalMetrics, "mrr"),
        emptyRetrievalRate: completed.length
          ? retrievalMetrics.filter((item) => item?.emptyRetrieval === true).length /
            completed.length
          : null
      },
      answer: {
        correctness: this.average(answerMetrics, "correctness"),
        faithfulness: this.average(answerMetrics, "faithfulness"),
        relevance: this.average(answerMetrics, "relevance")
      },
      runtime: {
        successRate: results.length ? completed.length / results.length : null,
        p95TotalMs: this.percentile(runtimeMetrics, "totalMs", 0.95),
        promptTokens: totals.promptTokens,
        completionTokens: totals.completionTokens,
        totalTokens: totals.totalTokens,
        evaluatedCostMicros: currency ? totals.evaluatedCostMicros : null,
        graderCostMicros: currency ? totals.graderCostMicros : null,
        totalCostMicros: currency ? totals.evaluatedCostMicros + totals.graderCostMicros : null,
        currency
      },
      sampleCount: completed.length,
      totalCases: results.length,
      metricsVersion: "v2"
    };
    await this.prisma.evaluationRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        summaryMetrics: summary,
        metricsVersion: "v2",
        heartbeatAt: new Date(),
        finishedAt: new Date()
      }
    });
  }

  private async finishCanceled(runId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.evaluationCaseResult.updateMany({
        where: { runId, status: "RUNNING" },
        data: { status: "SKIPPED", errorType: "CANCELED", finishedAt: new Date() }
      }),
      this.prisma.evaluationRun.update({
        where: { id: runId },
        data: { status: "CANCELED", finishedAt: new Date(), heartbeatAt: new Date() }
      })
    ]);
  }

  private buildEvaluationPrompt(
    question: string,
    sources: Array<{ documentName: string; content: string }>
  ): string {
    const context = sources.length
      ? sources
          .map((source, index) => `[${index + 1}] ${source.documentName}\n${source.content}`)
          .join("\n\n")
      : "（没有检索到知识片段）";
    return `请仅根据以下知识上下文回答问题；上下文不足时明确说明不知道。\n\n知识上下文：\n${context}\n\n问题：${question}`;
  }

  private average(rows: Array<Record<string, unknown> | null>, key: string): number | null {
    const values = rows
      .map((row) => row?.[key])
      .filter((value): value is number => typeof value === "number");
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  private percentile(
    rows: Array<Record<string, unknown> | null>,
    key: string,
    percentile: number
  ): number | null {
    const values = rows
      .map((row) => row?.[key])
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    if (!values.length) return null;
    return values[Math.max(0, Math.ceil(values.length * percentile) - 1)] ?? null;
  }

  private buildUsage(
    usage:
      { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null | undefined,
    pricing: PricingSnapshot
  ) {
    if (!usage) return null;
    const inputPrice = this.price(pricing.inputTokenPricePerMillion);
    const outputPrice = this.price(pricing.outputTokenPricePerMillion);
    const costMicros =
      inputPrice === null || outputPrice === null
        ? null
        : Math.round(
            (usage.promptTokens ?? 0) * inputPrice + (usage.completionTokens ?? 0) * outputPrice
          );
    return {
      inputTokens: usage.promptTokens ?? 0,
      outputTokens: usage.completionTokens ?? 0,
      totalTokens: usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
      costMicros,
      currency: costMicros === null ? null : pricing.priceCurrency
    };
  }

  private price(value: string | null | undefined): number | null {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private number(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "unknown evaluation error";
    return message
      .replace(/(api[_-]?key|authorization|token)\s*[:=]\s*\S+/giu, "$1=[REDACTED]")
      .slice(0, 1000);
  }
}
