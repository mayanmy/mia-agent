import { HttpStatus, Injectable } from "@nestjs/common";
import { ModelConfigType, Prisma } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  KnowledgeBaseCreateDto,
  KnowledgeBaseDetail,
  KnowledgeBaseListItem,
  KnowledgeBaseQueryDto,
  KnowledgeBaseUpdateDto
} from "./dto/knowledge.dto";

type KnowledgeBaseWithStats = Prisma.KnowledgeBaseGetPayload<{
  include: {
    embeddingModelConfig: {
      include: {
        provider: true;
      };
    };
    _count: {
      select: {
        documents: true;
        chunks: true;
      };
    };
  };
}> & {
  failedDocumentCount: number;
};

type KnowledgeBaseCreateData = {
  name: string;
  description: string;
  embeddingModelConfigId: string;
  enabled: boolean;
};

type KnowledgeBaseUpdateData = Partial<KnowledgeBaseCreateData>;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvidersService: ModelProvidersService
  ) {}

  async listKnowledgeBases(
    query: KnowledgeBaseQueryDto
  ): Promise<PageResult<KnowledgeBaseListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.KnowledgeBaseWhereInput = {
      deletedAt: null,
      ...(query.enabled !== undefined ? { enabled: this.parseEnabled(query.enabled) } : {})
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.knowledgeBase.findMany({
        where,
        include: this.getKnowledgeBaseInclude(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.knowledgeBase.count({ where })
    ]);
    const failedCounts = await this.getFailedDocumentCounts(list.map((item) => item.id));

    return createPageResult(
      list.map((knowledgeBase) =>
        this.toKnowledgeBaseListItem({
          ...knowledgeBase,
          failedDocumentCount: failedCounts.get(knowledgeBase.id) ?? 0
        })
      ),
      total,
      page.page,
      page.pageSize
    );
  }

  async createKnowledgeBase(payload: KnowledgeBaseCreateDto): Promise<KnowledgeBaseDetail> {
    const data = this.validateCreate(payload);
    await this.modelProvidersService.ensureEnabledModelConfig(
      data.embeddingModelConfigId,
      ModelConfigType.EMBEDDING
    );
    await this.ensureNameAvailable(data.name);

    const knowledgeBase = await this.prisma.knowledgeBase.create({
      data,
      include: this.getKnowledgeBaseInclude()
    });

    return this.toKnowledgeBaseListItem({
      ...knowledgeBase,
      failedDocumentCount: 0
    });
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBaseDetail> {
    const knowledgeBase = await this.findKnowledgeBaseDetail(id);
    return this.toKnowledgeBaseListItem(knowledgeBase);
  }

  async updateKnowledgeBase(
    id: string,
    payload: KnowledgeBaseUpdateDto
  ): Promise<KnowledgeBaseDetail> {
    await this.ensureKnowledgeBaseExists(id);
    const data = this.validateUpdate(payload);

    if (data.embeddingModelConfigId) {
      await this.modelProvidersService.ensureEnabledModelConfig(
        data.embeddingModelConfigId,
        ModelConfigType.EMBEDDING
      );
    }

    if (data.name) {
      await this.ensureNameAvailable(data.name, id);
    }

    const knowledgeBase = await this.prisma.knowledgeBase.update({
      where: { id },
      data,
      include: this.getKnowledgeBaseInclude()
    });
    const failedCounts = await this.getFailedDocumentCounts([id]);

    return this.toKnowledgeBaseListItem({
      ...knowledgeBase,
      failedDocumentCount: failedCounts.get(id) ?? 0
    });
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.ensureKnowledgeBaseExists(id);

    await this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        enabled: false
      }
    });
  }

  private validateCreate(payload: KnowledgeBaseCreateDto): KnowledgeBaseCreateData {
    return {
      name: this.requireNonEmptyString(payload.name, "name"),
      description: this.normalizeOptionalString(payload.description),
      embeddingModelConfigId: this.requireNonEmptyString(
        payload.embeddingModelConfigId,
        "embeddingModelConfigId"
      ),
      enabled: payload.enabled ?? true
    };
  }

  private validateUpdate(payload: KnowledgeBaseUpdateDto): KnowledgeBaseUpdateData {
    return {
      ...(payload.name !== undefined
        ? { name: this.requireNonEmptyString(payload.name, "name") }
        : {}),
      ...(payload.description !== undefined
        ? { description: this.normalizeOptionalString(payload.description) }
        : {}),
      ...(payload.embeddingModelConfigId !== undefined
        ? {
            embeddingModelConfigId: this.requireNonEmptyString(
              payload.embeddingModelConfigId,
              "embeddingModelConfigId"
            )
          }
        : {}),
      ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {})
    };
  }

  private requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }

    return value.trim();
  }

  private normalizeOptionalString(value: unknown): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "description must be a string");
    }

    return value.trim();
  }

  private parseEnabled(value: string): boolean {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    throw new AppError(ErrorCodes.common.badRequest, "enabled must be true or false");
  }

  private async ensureNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: {
        name,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {})
      }
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.knowledge.nameExists,
        "knowledge base name already exists",
        HttpStatus.CONFLICT
      );
    }
  }

  private async ensureKnowledgeBaseExists(id: string): Promise<void> {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: {
        id,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      throw new AppError(
        ErrorCodes.knowledge.notFound,
        "knowledge base not found",
        HttpStatus.NOT_FOUND
      );
    }
  }

  private async findKnowledgeBaseDetail(id: string): Promise<KnowledgeBaseWithStats> {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: {
        id,
        deletedAt: null
      },
      include: this.getKnowledgeBaseInclude()
    });

    if (!knowledgeBase) {
      throw new AppError(
        ErrorCodes.knowledge.notFound,
        "knowledge base not found",
        HttpStatus.NOT_FOUND
      );
    }

    const failedCounts = await this.getFailedDocumentCounts([id]);

    return {
      ...knowledgeBase,
      failedDocumentCount: failedCounts.get(id) ?? 0
    };
  }

  private getKnowledgeBaseInclude() {
    return {
      embeddingModelConfig: {
        include: {
          provider: true
        }
      },
      _count: {
        select: {
          documents: {
            where: {
              deletedAt: null
            }
          },
          chunks: {
            where: {
              deletedAt: null
            }
          }
        }
      }
    } satisfies Prisma.KnowledgeBaseInclude;
  }

  private async getFailedDocumentCounts(knowledgeBaseIds: string[]): Promise<Map<string, number>> {
    if (knowledgeBaseIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.knowledgeDocument.groupBy({
      by: ["knowledgeBaseId"],
      where: {
        knowledgeBaseId: {
          in: knowledgeBaseIds
        },
        status: "failed",
        deletedAt: null
      },
      _count: {
        _all: true
      }
    });

    return new Map(rows.map((row) => [row.knowledgeBaseId, row._count._all]));
  }

  private toKnowledgeBaseListItem(knowledgeBase: KnowledgeBaseWithStats): KnowledgeBaseListItem {
    return {
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description,
      embeddingModelConfigId: knowledgeBase.embeddingModelConfigId,
      embeddingModelName: knowledgeBase.embeddingModelConfig.modelName,
      embeddingProviderName: knowledgeBase.embeddingModelConfig.provider.name,
      documentCount: knowledgeBase._count.documents,
      chunkCount: knowledgeBase._count.chunks,
      failedDocumentCount: knowledgeBase.failedDocumentCount,
      enabled: knowledgeBase.enabled,
      createdAt: knowledgeBase.createdAt,
      updatedAt: knowledgeBase.updatedAt
    };
  }
}
