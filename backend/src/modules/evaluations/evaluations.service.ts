import { HttpStatus, Injectable } from "@nestjs/common";
import {
  EvaluationCaseSourceType,
  EvaluationDatasetStatus,
  EvaluationDatasetVersionStatus,
  Prisma
} from "@prisma/client";
import { createHash } from "node:crypto";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateEvaluationCaseDto,
  CreateEvaluationDatasetDto,
  CreateEvaluationVersionDto,
  EvaluationCaseQueryDto,
  EvaluationDatasetDetail,
  EvaluationDatasetListItem,
  EvaluationDatasetQueryDto,
  EvaluationVersionSummary,
  FreezeEvaluationVersionDto,
  UpdateEvaluationCaseDto,
  UpdateEvaluationDatasetDto
} from "./dto/evaluation.dto";

const DATASET_NAME_MAX = 100;
const DESCRIPTION_MAX = 1000;
const QUESTION_MAX = 20_000;
const EXPECTED_ANSWER_MAX = 50_000;

@Injectable()
export class EvaluationsService {
  constructor(private readonly prisma: PrismaService) {}

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
