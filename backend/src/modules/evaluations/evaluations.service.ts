import { HttpStatus, Injectable } from "@nestjs/common";
import {
  EvaluationCaseSourceType,
  EvaluationDatasetStatus,
  EvaluationDatasetVersionStatus,
  Prisma
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { AgentsService } from "../agents/agents.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { EvaluationQueueService } from "../../jobs/evaluation-queue.service";
import {
  EvaluationImportError,
  ImportedEvaluationCase,
  parseEvaluationImport
} from "./dataset-import";
import {
  CreateEvaluationCaseDto,
  CreateEvaluationDatasetDto,
  CreateEvaluationVersionDto,
  CommitEvaluationImportDto,
  CreateEvaluationRunDto,
  EvaluationCaseQueryDto,
  EvaluationDatasetDetail,
  EvaluationComparisonQueryDto,
  EvaluationDatasetListItem,
  EvaluationDatasetQueryDto,
  EvaluationRunQueryDto,
  EvaluationRunResultQueryDto,
  EvaluationVersionSummary,
  FreezeEvaluationVersionDto,
  UploadedEvaluationFile,
  UpdateEvaluationCaseDto,
  UpdateEvaluationDatasetDto
} from "./dto/evaluation.dto";

const DATASET_NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const QUESTION_MAX = 20_000;
const EXPECTED_ANSWER_MAX = 50_000;
const IMPORT_TOKEN_TTL_MS = 15 * 60_000;

type PendingImport = {
  workspaceId: string;
  userId: string;
  versionId: string;
  rows: ImportedEvaluationCase[];
  errors: EvaluationImportError[];
  duplicateCount: number;
  expiresAt: number;
};

@Injectable()
export class EvaluationsService {
  private readonly pendingImports = new Map<string, PendingImport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService?: AgentsService,
    private readonly evaluationQueue?: EvaluationQueueService,
    private readonly modelProvidersService?: ModelProvidersService
  ) {}

  async listRuns(query: EvaluationRunQueryDto) {
    const page = normalizePageQuery(query);
    const where: Prisma.EvaluationRunWhereInput = {
      workspaceId: requireWorkspaceId(),
      ...(query.status ? { status: query.status } : {}),
      ...(query.datasetVersionId ? { datasetVersionId: query.datasetVersionId } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {})
    };
    const [rows, total] = await Promise.all([
      this.prisma.evaluationRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: { datasetVersion: { include: { dataset: true } } }
      }),
      this.prisma.evaluationRun.count({ where })
    ]);
    return createPageResult(
      rows.map((row) => this.toRunSummary(row)),
      total,
      page.page,
      page.pageSize
    );
  }

  async createRun(payload: CreateEvaluationRunDto, userId: string) {
    const datasetVersionId = this.requireId(payload.datasetVersionId, "datasetVersionId");
    const agentId = this.requireId(payload.agentId, "agentId");
    const version = await this.prisma.evaluationDatasetVersion.findFirst({
      where: { id: datasetVersionId, dataset: { workspaceId: requireWorkspaceId() } },
      include: { dataset: true, cases: { select: { id: true } } }
    });
    if (!version) this.throwNotFound();
    if (version.status !== "FROZEN") {
      throw new AppError(
        ErrorCodes.common.conflict,
        "evaluation run requires a frozen dataset version",
        HttpStatus.CONFLICT
      );
    }
    if (version.dataset.status === "ARCHIVED") {
      throw new AppError(
        ErrorCodes.common.conflict,
        "archived dataset cannot create runs",
        HttpStatus.CONFLICT
      );
    }
    if (!this.agentsService || !this.evaluationQueue) {
      throw new Error("evaluation run dependencies are unavailable");
    }
    // 评测必须固定不可变版本；旧客户端未传版本时先从当前草稿生成候选版本。
    const agentVersion = payload.agentVersionId?.trim()
      ? await this.agentsService.getAgentVersion(agentId, payload.agentVersionId.trim())
      : await this.agentsService.createAgentVersion(agentId, {
          changeSummary: "评测运行自动冻结"
        });
    const runtime = await this.agentsService.getVersionRuntimeConfig(agentId, agentVersion.id);
    const evaluatedModel = await this.modelProvidersService?.getEvaluationModelConfig(
      runtime.modelConfigId
    );
    const graderModelConfigId = payload.graderModelConfigId?.trim() || null;
    const graderModel = graderModelConfigId
      ? await this.modelProvidersService?.getEvaluationModelConfig(graderModelConfigId)
      : null;
    const topK = this.normalizeTopK(payload.overrides?.retrieval?.topK);
    const scoreThreshold = this.normalizeScoreThreshold(
      payload.overrides?.retrieval?.scoreThreshold
    );
    if (payload.baselineRunId)
      await this.requireCompatibleBaseline(payload.baselineRunId, datasetVersionId);

    // 快照白名单刻意排除 baseUrl、密钥、连接串和内部 SDK 对象。
    const agentSnapshot = {
      agentId: runtime.agentId,
      name: runtime.name,
      systemPrompt: runtime.systemPrompt,
      modelConfigId: runtime.modelConfigId,
      temperature: runtime.temperature,
      maxTokens: runtime.maxTokens,
      timeoutSeconds: runtime.timeoutSeconds,
      thinkingMode: runtime.thinkingMode
    };
    const retrievalSnapshot = {
      knowledgeBaseIds: runtime.knowledgeBaseIds,
      topK,
      ...(scoreThreshold === undefined ? {} : { scoreThreshold })
    };
    const modelSnapshot = {
      modelConfigId: runtime.modelConfigId,
      modelName: runtime.modelName,
      providerId: runtime.providerId,
      providerType: runtime.providerType,
      inputTokenPricePerMillion: evaluatedModel?.inputTokenPricePerMillion ?? null,
      outputTokenPricePerMillion: evaluatedModel?.outputTokenPricePerMillion ?? null,
      priceCurrency: evaluatedModel?.priceCurrency ?? "CNY"
    };
    const graderSnapshot = graderModel
      ? {
          enabled: true,
          modelConfigId: graderModel.id,
          modelName: graderModel.modelName,
          providerId: graderModel.providerId,
          promptVersion: "rag-judge-v1",
          inputTokenPricePerMillion: graderModel.inputTokenPricePerMillion,
          outputTokenPricePerMillion: graderModel.outputTokenPricePerMillion,
          priceCurrency: graderModel.priceCurrency
        }
      : { enabled: false, promptVersion: "rag-judge-v1" };
    const snapshotHash = createHash("sha256")
      .update(
        JSON.stringify({
          datasetVersionId,
          agentSnapshot,
          retrievalSnapshot,
          modelSnapshot,
          graderSnapshot
        })
      )
      .digest("hex");
    const run = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.evaluationRun.create({
        data: {
          workspaceId: requireWorkspaceId(),
          datasetVersionId,
          agentId,
          agentVersionId: agentVersion.id,
          baselineRunId: payload.baselineRunId || null,
          totalCases: version.cases.length,
          agentConfigSnapshot: agentSnapshot,
          retrievalConfigSnapshot: retrievalSnapshot,
          modelConfigSnapshot: modelSnapshot,
          graderConfigSnapshot: graderSnapshot,
          metricsVersion: "v2",
          snapshotHash,
          createdByUserId: userId
        }
      });
      if (version.cases.length) {
        await transaction.evaluationCaseResult.createMany({
          data: version.cases.map(({ id }) => ({ runId: created.id, caseId: id }))
        });
      }
      await transaction.evaluationJob.create({ data: { runId: created.id } });
      return created;
    });
    void this.evaluationQueue.dispatchPending().catch(() => undefined);
    return { id: run.id, status: run.status, totalCases: run.totalCases, createdAt: run.createdAt };
  }

  async getRun(runId: string) {
    const run = await this.prisma.evaluationRun.findFirst({
      where: { id: runId, workspaceId: requireWorkspaceId() },
      include: { datasetVersion: { include: { dataset: true } } }
    });
    if (!run) this.throwNotFound();
    return {
      ...this.toRunSummary(run),
      agentConfigSnapshot: run.agentConfigSnapshot,
      retrievalConfigSnapshot: run.retrievalConfigSnapshot,
      modelConfigSnapshot: run.modelConfigSnapshot,
      graderConfigSnapshot: run.graderConfigSnapshot,
      errorType: run.errorType,
      errorMessage: run.errorMessage
    };
  }

  async cancelRun(runId: string) {
    const updated = await this.prisma.evaluationRun.updateMany({
      where: {
        id: runId,
        workspaceId: requireWorkspaceId(),
        status: { in: ["PENDING", "RUNNING"] }
      },
      data: { cancelRequestedAt: new Date() }
    });
    if (!updated.count) {
      const existing = await this.prisma.evaluationRun.findFirst({
        where: { id: runId, workspaceId: requireWorkspaceId() }
      });
      if (!existing) this.throwNotFound();
      throw new AppError(
        ErrorCodes.common.conflict,
        "only pending or running evaluation can be canceled",
        HttpStatus.CONFLICT
      );
    }
    return this.getRun(runId);
  }

  async listRunResults(runId: string, query: EvaluationRunResultQueryDto) {
    await this.requireRun(runId);
    const page = normalizePageQuery(query);
    const where = { runId };
    const [rows, total] = await Promise.all([
      this.prisma.evaluationCaseResult.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: page.skip,
        take: page.take,
        include: { evaluationCase: true }
      }),
      this.prisma.evaluationCaseResult.count({ where })
    ]);
    return createPageResult(rows, total, page.page, page.pageSize);
  }

  async listCompatibleBaselines(runId: string) {
    const candidate = await this.requireRun(runId);
    const rows = await this.prisma.evaluationRun.findMany({
      where: {
        workspaceId: requireWorkspaceId(),
        datasetVersionId: candidate.datasetVersionId,
        status: "COMPLETED",
        id: { not: runId }
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { datasetVersion: { include: { dataset: true } } }
    });
    return rows.map((row) => this.toRunSummary(row));
  }

  async getComparisonCompatibility(query: EvaluationComparisonQueryDto) {
    const { baseline, candidate } = await this.requireComparisonRuns(query);
    const reasons: Array<{
      field: string;
      baselineValue: unknown;
      candidateValue: unknown;
      message: string;
    }> = [];
    if (baseline.datasetVersionId !== candidate.datasetVersionId) {
      reasons.push({
        field: "datasetVersionId",
        baselineValue: baseline.datasetVersionId,
        candidateValue: candidate.datasetVersionId,
        message: "Baseline 与 Candidate 必须使用同一冻结数据集版本"
      });
    }
    if (baseline.metricsVersion !== candidate.metricsVersion) {
      reasons.push({
        field: "metricsVersion",
        baselineValue: baseline.metricsVersion,
        candidateValue: candidate.metricsVersion,
        message: "两次运行的指标版本不同"
      });
    }
    if (baseline.status !== "COMPLETED" || candidate.status !== "COMPLETED") {
      reasons.push({
        field: "status",
        baselineValue: baseline.status,
        candidateValue: candidate.status,
        message: "只有已完成的运行可以生成精确对比"
      });
    }
    return { compatible: reasons.length === 0, reasons };
  }

  async getComparison(query: EvaluationComparisonQueryDto) {
    const { baseline, candidate } = await this.requireComparisonRuns(query);
    const compatibility = await this.getComparisonCompatibility(query);
    const baselineSummary = baseline.summaryMetrics as Record<string, unknown> | null;
    const candidateSummary = candidate.summaryMetrics as Record<string, unknown> | null;
    const catalog = [
      { key: "retrieval.hitRateAt5", label: "HitRate@5", direction: "higher_is_better" as const },
      { key: "retrieval.recallAt5", label: "Recall@5", direction: "higher_is_better" as const },
      { key: "retrieval.mrr", label: "MRR", direction: "higher_is_better" as const },
      {
        key: "retrieval.emptyRetrievalRate",
        label: "空召回率",
        direction: "lower_is_better" as const
      },
      { key: "answer.correctness", label: "答案正确性", direction: "higher_is_better" as const },
      { key: "answer.faithfulness", label: "忠实度", direction: "higher_is_better" as const },
      { key: "answer.relevance", label: "答案相关性", direction: "higher_is_better" as const },
      { key: "runtime.successRate", label: "成功率", direction: "higher_is_better" as const },
      { key: "runtime.p95TotalMs", label: "P95 总耗时", direction: "lower_is_better" as const },
      {
        key: "runtime.totalCostMicros",
        label: "估算成本（微货币单位）",
        direction: "lower_is_better" as const
      }
    ];
    const metrics = catalog.map((item) => {
      const baselineValue = this.readMetric(baselineSummary, item.key);
      const candidateValue = this.readMetric(candidateSummary, item.key);
      const absoluteDelta =
        baselineValue === null || candidateValue === null ? null : candidateValue - baselineValue;
      const relativeDelta =
        absoluteDelta === null || baselineValue === null || baselineValue === 0
          ? null
          : absoluteDelta / Math.abs(baselineValue);
      return {
        ...item,
        baselineValue,
        candidateValue,
        absoluteDelta,
        relativeDelta,
        sampleCount: this.readMetric(candidateSummary, "sampleCount") ?? 0,
        verdict:
          !compatibility.compatible || absoluteDelta === null
            ? "not_comparable"
            : Math.abs(absoluteDelta) < 1e-9
              ? "unchanged"
              : (item.direction === "higher_is_better" ? absoluteDelta > 0 : absoluteDelta < 0)
                ? "improved"
                : "regressed"
      };
    });
    const caseCounts = compatibility.compatible
      ? await this.compareCaseResults(baseline.id, candidate.id)
      : { improved: 0, regressed: 0, unchanged: 0, mixed: 0 };
    return {
      baseline: await this.getRun(baseline.id),
      candidate: await this.getRun(candidate.id),
      compatibility,
      metrics,
      caseCounts,
      gateResult: "not_evaluated"
    };
  }

  async listDatasets(query: EvaluationDatasetQueryDto) {
    const page = normalizePageQuery(query);
    const keyword = query.keyword?.trim();
    const where: Prisma.EvaluationDatasetWhereInput = {
      workspaceId: requireWorkspaceId(),
      ...(query.status ? { status: query.status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: "insensitive" } },
              { description: { contains: keyword, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const [rows, total] = await Promise.all([
      this.prisma.evaluationDataset.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: { versions: { orderBy: { version: "desc" }, take: 1 } }
      }),
      this.prisma.evaluationDataset.count({ where })
    ]);
    return createPageResult(
      rows.map((row) => this.toDatasetListItem(row)),
      total,
      page.page,
      page.pageSize
    );
  }

  async createDataset(
    payload: CreateEvaluationDatasetDto,
    userId: string
  ): Promise<EvaluationDatasetDetail> {
    const name = this.normalizeRequiredText(payload.name, "name", DATASET_NAME_MAX);
    const description = this.normalizeOptionalText(payload.description, DESCRIPTION_MAX) ?? "";
    try {
      const dataset = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.evaluationDataset.create({
          data: {
            workspaceId: requireWorkspaceId(),
            name,
            normalizedName: this.normalizeName(name),
            description,
            createdByUserId: userId
          }
        });
        await transaction.evaluationDatasetVersion.create({
          data: { datasetId: created.id, version: 1, createdByUserId: userId }
        });
        return created;
      });
      return this.getDataset(dataset.id);
    } catch (error) {
      this.throwIfUniqueConflict(error, "evaluation dataset name already exists");
      throw error;
    }
  }

  async getDataset(datasetId: string): Promise<EvaluationDatasetDetail> {
    const dataset = await this.prisma.evaluationDataset.findFirst({
      where: { id: datasetId, workspaceId: requireWorkspaceId() },
      include: { versions: { orderBy: { version: "desc" } } }
    });
    if (!dataset) this.throwNotFound();
    const versions = dataset.versions.map((version) => this.toVersionSummary(version));
    return { ...this.toDatasetListItem({ ...dataset, versions }), versions };
  }

  async updateDataset(
    datasetId: string,
    payload: UpdateEvaluationDatasetDto
  ): Promise<EvaluationDatasetDetail> {
    const current = await this.requireDataset(datasetId);
    const name =
      payload.name === undefined
        ? current.name
        : this.normalizeRequiredText(payload.name, "name", DATASET_NAME_MAX);
    const description =
      payload.description === undefined
        ? current.description
        : (this.normalizeOptionalText(payload.description, DESCRIPTION_MAX) ?? "");
    try {
      await this.prisma.evaluationDataset.update({
        where: { id: datasetId },
        data: { name, normalizedName: this.normalizeName(name), description }
      });
    } catch (error) {
      this.throwIfUniqueConflict(error, "evaluation dataset name already exists");
      throw error;
    }
    return this.getDataset(datasetId);
  }

  async setDatasetStatus(datasetId: string, status: EvaluationDatasetStatus) {
    await this.requireDataset(datasetId);
    await this.prisma.evaluationDataset.update({ where: { id: datasetId }, data: { status } });
    return this.getDataset(datasetId);
  }

  async createVersion(
    datasetId: string,
    payload: CreateEvaluationVersionDto,
    userId: string
  ): Promise<EvaluationVersionSummary> {
    const dataset = await this.requireDataset(datasetId);
    if (dataset.status === EvaluationDatasetStatus.ARCHIVED) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "archived dataset cannot create versions",
        HttpStatus.CONFLICT
      );
    }
    const existingDraft = await this.prisma.evaluationDatasetVersion.findFirst({
      where: { datasetId, status: EvaluationDatasetVersionStatus.DRAFT }
    });
    if (existingDraft) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "dataset already has a draft version",
        HttpStatus.CONFLICT
      );
    }
    const source = payload.sourceVersionId
      ? await this.requireVersion(payload.sourceVersionId, datasetId)
      : null;
    if (source && source.status !== EvaluationDatasetVersionStatus.FROZEN) {
      throw new AppError(ErrorCodes.common.badRequest, "source version must be frozen");
    }
    const aggregate = await this.prisma.evaluationDatasetVersion.aggregate({
      where: { datasetId },
      _max: { version: true }
    });
    const version = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.evaluationDatasetVersion.create({
        data: {
          datasetId,
          version: (aggregate._max.version ?? 0) + 1,
          caseCount: source?.caseCount ?? 0,
          createdByUserId: userId
        }
      });
      if (source) {
        const cases = await transaction.evaluationCase.findMany({
          where: { datasetVersionId: source.id }
        });
        if (cases.length) {
          await transaction.evaluationCase.createMany({
            data: cases.map((item) => ({
              datasetVersionId: created.id,
              question: item.question,
              questionHash: item.questionHash,
              expectedAnswer: item.expectedAnswer,
              expectedDocumentIds: item.expectedDocumentIds,
              expectedChunkIds: item.expectedChunkIds,
              answerable: item.answerable,
              category: item.category,
              difficulty: item.difficulty,
              sourceType: item.sourceType,
              sourceFeedbackId: item.sourceFeedbackId,
              metadata: item.metadata ?? undefined,
              createdByUserId: userId
            }))
          });
        }
      }
      return created;
    });
    return this.toVersionSummary(version);
  }

  async getVersion(versionId: string) {
    const version = await this.requireVersion(versionId);
    return this.toVersionSummary(version);
  }

  async listCases(versionId: string, query: EvaluationCaseQueryDto) {
    await this.requireVersion(versionId);
    const page = normalizePageQuery(query);
    const keyword = query.keyword?.trim();
    const where: Prisma.EvaluationCaseWhereInput = {
      datasetVersionId: versionId,
      ...(keyword ? { question: { contains: keyword, mode: "insensitive" } } : {}),
      ...(query.category?.trim() ? { category: query.category.trim() } : {})
    };
    const [list, total] = await Promise.all([
      this.prisma.evaluationCase.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take
      }),
      this.prisma.evaluationCase.count({ where })
    ]);
    return createPageResult(list, total, page.page, page.pageSize);
  }

  async createCase(versionId: string, payload: CreateEvaluationCaseDto, userId: string) {
    await this.requireMutableVersion(versionId);
    const data = this.normalizeCasePayload(payload);
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const item = await transaction.evaluationCase.create({
          data: { datasetVersionId: versionId, ...data, createdByUserId: userId }
        });
        await transaction.evaluationDatasetVersion.update({
          where: { id: versionId },
          data: { caseCount: { increment: 1 }, revision: { increment: 1 } }
        });
        return item;
      });
      return created;
    } catch (error) {
      this.throwIfUniqueConflict(error, "evaluation question already exists in this version");
      throw error;
    }
  }

  async updateCase(versionId: string, caseId: string, payload: UpdateEvaluationCaseDto) {
    await this.requireMutableVersion(versionId);
    await this.requireCase(versionId, caseId);
    const data = this.normalizeCasePayload(payload);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const item = await transaction.evaluationCase.update({ where: { id: caseId }, data });
        await transaction.evaluationDatasetVersion.update({
          where: { id: versionId },
          data: { revision: { increment: 1 } }
        });
        return item;
      });
    } catch (error) {
      this.throwIfUniqueConflict(error, "evaluation question already exists in this version");
      throw error;
    }
  }

  async deleteCase(versionId: string, caseId: string): Promise<void> {
    await this.requireMutableVersion(versionId);
    await this.requireCase(versionId, caseId);
    await this.prisma.$transaction([
      this.prisma.evaluationCase.delete({ where: { id: caseId } }),
      this.prisma.evaluationDatasetVersion.update({
        where: { id: versionId },
        data: { caseCount: { decrement: 1 }, revision: { increment: 1 } }
      })
    ]);
  }

  async freezeVersion(versionId: string, payload: FreezeEvaluationVersionDto) {
    const version = await this.requireMutableVersion(versionId);
    if (version.caseCount === 0) {
      throw new AppError(ErrorCodes.common.badRequest, "empty dataset version cannot be frozen");
    }
    if (!Number.isInteger(payload.expectedRevision)) {
      throw new AppError(ErrorCodes.common.badRequest, "expectedRevision is required");
    }
    const result = await this.prisma.evaluationDatasetVersion.updateMany({
      where: {
        id: versionId,
        revision: payload.expectedRevision,
        status: EvaluationDatasetVersionStatus.DRAFT
      },
      data: {
        status: EvaluationDatasetVersionStatus.FROZEN,
        frozenAt: new Date(),
        revision: { increment: 1 }
      }
    });
    if (result.count !== 1) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "dataset version changed, refresh and retry",
        HttpStatus.CONFLICT
      );
    }
    return this.getVersion(versionId);
  }

  async previewImport(versionId: string, file: UploadedEvaluationFile | undefined, userId: string) {
    await this.requireMutableVersion(versionId);
    if (!file?.buffer?.length)
      throw new AppError(ErrorCodes.common.badRequest, "import file is required");
    let parsed;
    try {
      parsed = parseEvaluationImport(file.originalname, file.buffer);
    } catch (error) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        error instanceof Error ? error.message : "invalid import file"
      );
    }
    const existing = parsed.rows.length
      ? await this.prisma.evaluationCase.findMany({
          where: {
            datasetVersionId: versionId,
            questionHash: { in: parsed.rows.map((row) => row.questionHash) }
          },
          select: { questionHash: true }
        })
      : [];
    const knownHashes = new Set(existing.map((item) => item.questionHash));
    const fileHashes = new Set<string>();
    const rows: ImportedEvaluationCase[] = [];
    const errors = [...parsed.errors];
    let duplicateCount = 0;
    for (const row of parsed.rows) {
      if (knownHashes.has(row.questionHash) || fileHashes.has(row.questionHash)) {
        duplicateCount += 1;
        errors.push({ line: row.line, message: "duplicate question" });
        continue;
      }
      fileHashes.add(row.questionHash);
      rows.push(row);
    }
    this.pruneExpiredImports();
    const importToken = randomUUID();
    this.pendingImports.set(importToken, {
      workspaceId: requireWorkspaceId(),
      userId,
      versionId,
      rows,
      errors,
      duplicateCount,
      expiresAt: Date.now() + IMPORT_TOKEN_TTL_MS
    });
    return {
      importToken,
      expiresAt: new Date(Date.now() + IMPORT_TOKEN_TTL_MS),
      totalRows: parsed.totalRows,
      validCount: rows.length,
      errorCount: errors.length - duplicateCount,
      duplicateCount,
      preview: rows.slice(0, 20).map(({ questionHash: _questionHash, ...row }) => row),
      errors
    };
  }

  async commitImport(versionId: string, payload: CommitEvaluationImportDto, userId: string) {
    await this.requireMutableVersion(versionId);
    const token = payload.importToken?.trim();
    if (!token) throw new AppError(ErrorCodes.common.badRequest, "importToken is required");
    const pending = this.pendingImports.get(token);
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      pending.workspaceId !== requireWorkspaceId() ||
      pending.userId !== userId ||
      pending.versionId !== versionId
    ) {
      this.pendingImports.delete(token);
      throw new AppError(
        ErrorCodes.common.badRequest,
        "import preview expired or does not belong to this request"
      );
    }
    if (pending.errors.length > 0 && !payload.onlyValidRows) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "import contains invalid rows; confirm onlyValidRows to continue"
      );
    }
    if (pending.rows.length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, "import has no valid rows");
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.evaluationCase.createMany({
          data: pending.rows.map((row) => ({
            datasetVersionId: versionId,
            question: row.question,
            questionHash: row.questionHash,
            expectedAnswer: row.expectedAnswer,
            expectedDocumentIds: row.expectedDocumentIds,
            expectedChunkIds: row.expectedChunkIds,
            answerable: row.answerable,
            category: row.category,
            difficulty: row.difficulty,
            sourceType: EvaluationCaseSourceType.IMPORT,
            createdByUserId: userId
          }))
        });
        await transaction.evaluationDatasetVersion.update({
          where: { id: versionId },
          data: { caseCount: { increment: pending.rows.length }, revision: { increment: 1 } }
        });
      });
    } catch (error) {
      this.throwIfUniqueConflict(error, "dataset changed after preview; preview the import again");
      throw error;
    }
    this.pendingImports.delete(token);
    return { importedCount: pending.rows.length, skippedCount: pending.errors.length };
  }

  private normalizeCasePayload(payload: CreateEvaluationCaseDto) {
    const question = this.normalizeRequiredText(payload.question, "question", QUESTION_MAX);
    return {
      question,
      questionHash: createHash("sha256")
        .update(question.replace(/\s+/gu, " ").toLocaleLowerCase())
        .digest("hex"),
      expectedAnswer: this.normalizeOptionalText(payload.expectedAnswer, EXPECTED_ANSWER_MAX),
      expectedDocumentIds: this.normalizeIds(payload.expectedDocumentIds, "expectedDocumentIds"),
      expectedChunkIds: this.normalizeIds(payload.expectedChunkIds, "expectedChunkIds"),
      answerable: payload.answerable ?? true,
      category: this.normalizeOptionalText(payload.category, 100),
      difficulty: this.normalizeOptionalText(payload.difficulty, 50),
      sourceType: payload.sourceType ?? EvaluationCaseSourceType.MANUAL,
      sourceFeedbackId: this.normalizeOptionalText(payload.sourceFeedbackId, 64)
    };
  }

  private pruneExpiredImports(): void {
    const now = Date.now();
    for (const [token, pending] of this.pendingImports) {
      if (pending.expiresAt <= now) this.pendingImports.delete(token);
    }
  }

  private async requireDataset(datasetId: string) {
    const dataset = await this.prisma.evaluationDataset.findFirst({
      where: { id: datasetId, workspaceId: requireWorkspaceId() }
    });
    if (!dataset) this.throwNotFound();
    return dataset;
  }

  private async requireVersion(versionId: string, datasetId?: string) {
    const version = await this.prisma.evaluationDatasetVersion.findFirst({
      where: {
        id: versionId,
        ...(datasetId ? { datasetId } : {}),
        dataset: { workspaceId: requireWorkspaceId() }
      }
    });
    if (!version) this.throwNotFound("evaluation dataset version not found");
    return version;
  }

  private async requireMutableVersion(versionId: string) {
    const version = await this.requireVersion(versionId);
    if (version.status !== EvaluationDatasetVersionStatus.DRAFT) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "frozen dataset version cannot be modified",
        HttpStatus.CONFLICT
      );
    }
    return version;
  }

  private async requireCase(versionId: string, caseId: string) {
    const item = await this.prisma.evaluationCase.findFirst({
      where: { id: caseId, datasetVersionId: versionId }
    });
    if (!item) this.throwNotFound("evaluation case not found");
    return item;
  }

  private async requireRun(runId: string) {
    const run = await this.prisma.evaluationRun.findFirst({
      where: { id: runId, workspaceId: requireWorkspaceId() }
    });
    if (!run) this.throwNotFound("evaluation run not found");
    return run;
  }

  private async requireCompatibleBaseline(runId: string, datasetVersionId: string): Promise<void> {
    const baseline = await this.prisma.evaluationRun.findFirst({
      where: { id: runId, workspaceId: requireWorkspaceId() }
    });
    if (!baseline) this.throwNotFound("baseline evaluation run not found");
    if (baseline.status !== "COMPLETED") {
      throw new AppError(
        ErrorCodes.common.conflict,
        "baseline run must be completed",
        HttpStatus.CONFLICT
      );
    }
    if (baseline.datasetVersionId !== datasetVersionId) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "baseline must use the same dataset version"
      );
    }
  }

  private async requireComparisonRuns(query: EvaluationComparisonQueryDto) {
    const baselineRunId = this.requireId(query.baselineRunId, "baselineRunId");
    const candidateRunId = this.requireId(query.candidateRunId, "candidateRunId");
    const [baseline, candidate] = await Promise.all([
      this.prisma.evaluationRun.findFirst({
        where: { id: baselineRunId, workspaceId: requireWorkspaceId() }
      }),
      this.prisma.evaluationRun.findFirst({
        where: { id: candidateRunId, workspaceId: requireWorkspaceId() }
      })
    ]);
    if (!baseline || !candidate) this.throwNotFound("evaluation run not found");
    return { baseline, candidate };
  }

  private readMetric(summary: Record<string, unknown> | null, path: string): number | null {
    let current: unknown = summary;
    for (const segment of path.split(".")) {
      if (!current || typeof current !== "object" || Array.isArray(current)) return null;
      current = (current as Record<string, unknown>)[segment];
    }
    return typeof current === "number" && Number.isFinite(current) ? current : null;
  }

  private async compareCaseResults(baselineRunId: string, candidateRunId: string) {
    const [baselineRows, candidateRows] = await Promise.all([
      this.prisma.evaluationCaseResult.findMany({ where: { runId: baselineRunId } }),
      this.prisma.evaluationCaseResult.findMany({ where: { runId: candidateRunId } })
    ]);
    const baselineByCase = new Map(baselineRows.map((row) => [row.caseId, row]));
    const counts = { improved: 0, regressed: 0, unchanged: 0, mixed: 0 };
    for (const candidate of candidateRows) {
      const baseline = baselineByCase.get(candidate.caseId);
      if (!baseline) continue;
      const baselineRetrieval = baseline.retrievalMetrics as Record<string, unknown> | null;
      const candidateRetrieval = candidate.retrievalMetrics as Record<string, unknown> | null;
      const baselineRuntime = baseline.runtimeMetrics as Record<string, unknown> | null;
      const candidateRuntime = candidate.runtimeMetrics as Record<string, unknown> | null;
      const qualityDelta = this.metricDelta(baselineRetrieval, candidateRetrieval, "recallAt5");
      const latencyDelta = this.metricDelta(baselineRuntime, candidateRuntime, "totalMs");
      const qualityVerdict =
        qualityDelta === null || Math.abs(qualityDelta) < 1e-9 ? 0 : qualityDelta > 0 ? 1 : -1;
      const latencyVerdict =
        latencyDelta === null || Math.abs(latencyDelta) < 1 ? 0 : latencyDelta < 0 ? 1 : -1;
      if (qualityVerdict && latencyVerdict && qualityVerdict !== latencyVerdict) counts.mixed += 1;
      else if (qualityVerdict > 0 || (!qualityVerdict && latencyVerdict > 0)) counts.improved += 1;
      else if (qualityVerdict < 0 || (!qualityVerdict && latencyVerdict < 0)) counts.regressed += 1;
      else counts.unchanged += 1;
    }
    return counts;
  }

  private metricDelta(
    baseline: Record<string, unknown> | null,
    candidate: Record<string, unknown> | null,
    key: string
  ): number | null {
    const before = baseline?.[key];
    const after = candidate?.[key];
    return typeof before === "number" && typeof after === "number" ? after - before : null;
  }

  private toRunSummary(run: {
    id: string;
    datasetVersionId: string;
    agentId: string;
    baselineRunId: string | null;
    status: string;
    totalCases: number;
    completedCases: number;
    failedCases: number;
    skippedCases: number;
    agentConfigSnapshot: Prisma.JsonValue;
    summaryMetrics: Prisma.JsonValue | null;
    cancelRequestedAt: Date | null;
    heartbeatAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
    datasetVersion: { version: number; dataset: { id: string; name: string } };
  }) {
    const agent = run.agentConfigSnapshot as { name?: string } | null;
    return {
      id: run.id,
      datasetVersionId: run.datasetVersionId,
      dataset: {
        id: run.datasetVersion.dataset.id,
        name: run.datasetVersion.dataset.name,
        version: run.datasetVersion.version
      },
      agentId: run.agentId,
      agentName: agent?.name ?? "—",
      baselineRunId: run.baselineRunId,
      status: run.status,
      totalCases: run.totalCases,
      completedCases: run.completedCases,
      failedCases: run.failedCases,
      skippedCases: run.skippedCases,
      summaryMetrics: run.summaryMetrics,
      cancelRequestedAt: run.cancelRequestedAt,
      heartbeatAt: run.heartbeatAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdByUserId: run.createdByUserId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    };
  }

  private requireId(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }
    return value.trim();
  }

  private normalizeTopK(value: unknown): number {
    if (value === undefined) return 5;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "retrieval topK must be an integer from 1 to 50"
      );
    }
    return Number(value);
  }

  private normalizeScoreThreshold(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        "retrieval scoreThreshold must be between 0 and 1"
      );
    }
    return value;
  }

  private toDatasetListItem(dataset: {
    id: string;
    name: string;
    description: string;
    status: EvaluationDatasetStatus;
    createdAt: Date;
    updatedAt: Date;
    versions: Array<Parameters<EvaluationsService["toVersionSummary"]>[0]>;
  }): EvaluationDatasetListItem {
    return {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description,
      status: dataset.status,
      latestVersion: dataset.versions[0] ? this.toVersionSummary(dataset.versions[0]) : null,
      createdAt: dataset.createdAt,
      updatedAt: dataset.updatedAt
    };
  }

  private toVersionSummary(version: {
    id: string;
    version: number;
    status: EvaluationDatasetVersionStatus;
    revision: number;
    caseCount: number;
    frozenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): EvaluationVersionSummary {
    return {
      id: version.id,
      version: version.version,
      status: version.status,
      revision: version.revision,
      caseCount: version.caseCount,
      frozenAt: version.frozenAt,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt
    };
  }

  private normalizeRequiredText(value: unknown, field: string, max: number): string {
    if (typeof value !== "string" || !value.trim())
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    const normalized = value.trim();
    if (normalized.length > max)
      throw new AppError(ErrorCodes.common.badRequest, `${field} cannot exceed ${max} characters`);
    return normalized;
  }

  private normalizeOptionalText(value: unknown, max: number): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string")
      throw new AppError(ErrorCodes.common.badRequest, "invalid text field");
    const normalized = value.trim();
    if (normalized.length > max)
      throw new AppError(ErrorCodes.common.badRequest, `text cannot exceed ${max} characters`);
    return normalized || null;
  }

  private normalizeIds(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} must be a string array`);
    }
    return [...new Set(value.map((item) => item.trim()))];
  }

  private normalizeName(value: string): string {
    return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  }

  private throwIfUniqueConflict(error: unknown, message: string): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(ErrorCodes.common.conflict, message, HttpStatus.CONFLICT);
    }
  }

  private throwNotFound(message = "evaluation dataset not found"): never {
    throw new AppError(ErrorCodes.common.notFound, message, HttpStatus.NOT_FOUND);
  }
}
