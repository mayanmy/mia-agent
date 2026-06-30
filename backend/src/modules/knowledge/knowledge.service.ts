import { HttpStatus, Injectable } from "@nestjs/common";
import { ModelConfigType, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { getConfig } from "../../core/config";
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
  KnowledgeBaseUpdateDto,
  KnowledgeBaseRetrievalConfig,
  KnowledgeDocumentStatus,
  KnowledgeDocumentListItem,
  KnowledgeDocumentQueryDto,
  UploadedKnowledgeFile
} from "./dto/knowledge.dto";
import { chunkText } from "./chunking";
import { isTextDocument, parseTextDocument } from "./parsing";

const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".pdf",
  ".docx",
  ".csv",
  ".json"
]);

const KNOWLEDGE_DOCUMENT_STATUSES: KnowledgeDocumentStatus[] = [
  "uploaded",
  "pending",
  "processing",
  "parsing",
  "chunking",
  "embedding",
  "indexed",
  "failed",
  "deleted"
];

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
    const embeddingDimension = await this.modelProvidersService.getEmbeddingModelDimension(
      data.embeddingModelConfigId
    );
    await this.ensureNameAvailable(data.name);

    const knowledgeBase = await this.prisma.knowledgeBase.create({
      // 知识库创建时锁定向量维度，后续文档索引和检索都以这个快照为准。
      data: {
        ...data,
        embeddingDimension
      },
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

  async listKnowledgeDocuments(
    knowledgeBaseId: string,
    query: KnowledgeDocumentQueryDto
  ): Promise<PageResult<KnowledgeDocumentListItem>> {
    await this.ensureKnowledgeBaseExists(knowledgeBaseId);
    const page = normalizePageQuery(query);
    const where: Prisma.KnowledgeDocumentWhereInput = {
      knowledgeBaseId,
      deletedAt: null,
      ...(query.status ? { status: this.normalizeDocumentStatus(query.status) } : {})
    };

    const [documents, total] = await this.prisma.$transaction([
      this.prisma.knowledgeDocument.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.knowledgeDocument.count({ where })
    ]);

    return createPageResult(
      documents.map((document) => this.toKnowledgeDocumentListItem(document)),
      total,
      page.page,
      page.pageSize
    );
  }

  async uploadKnowledgeDocument(
    knowledgeBaseId: string,
    file: UploadedKnowledgeFile | undefined
  ): Promise<KnowledgeDocumentListItem> {
    await this.ensureKnowledgeBaseExists(knowledgeBaseId);
    const normalizedFile = this.validateUploadedDocument(file);
    const documentId = randomUUID();
    const originalFilename = basename(normalizedFile.originalname);
    const filename = this.createStoredFilename(documentId, originalFilename);
    const storagePath = join(getConfig().knowledgeStorageDir, knowledgeBaseId, filename);
    const fileHash = createHash("sha256").update(normalizedFile.buffer).digest("hex");
    const shouldIndexText = isTextDocument(originalFilename);

    await mkdir(join(getConfig().knowledgeStorageDir, knowledgeBaseId), { recursive: true });
    await writeFile(storagePath, normalizedFile.buffer);

    try {
      const document = await this.prisma.knowledgeDocument.create({
        data: {
          id: documentId,
          knowledgeBaseId,
          filename,
          originalFilename,
          mimeType: normalizedFile.mimetype || "application/octet-stream",
          fileSize: normalizedFile.size,
          fileHash,
          storagePath,
          status: shouldIndexText ? "pending" : "uploaded"
        }
      });

      if (shouldIndexText) {
        return this.indexTextDocument(document, normalizedFile.buffer);
      }

      return this.toKnowledgeDocumentListItem(document);
    } catch (error) {
      await unlink(storagePath).catch(() => undefined);
      throw error;
    }
  }

  async deleteKnowledgeDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    await this.ensureKnowledgeBaseExists(knowledgeBaseId);
    const existing = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      throw new AppError(
        ErrorCodes.knowledge.documentNotFound,
        "knowledge document not found",
        HttpStatus.NOT_FOUND
      );
    }

    const deletedAt = new Date();

    // 删除文档时同时清理所有维度分表里的向量，避免软删除 chunk 仍被旧索引命中。
    await this.deleteEmbeddingsForDocument(documentId);

    await this.prisma.$transaction([
      this.prisma.knowledgeDocument.update({
        where: {
          id: documentId
        },
        data: {
          deletedAt,
          status: "deleted"
        }
      }),
      this.prisma.knowledgeChunk.updateMany({
        where: {
          documentId,
          deletedAt: null
        },
        data: {
          deletedAt
        }
      })
    ]);
  }

  async reindexKnowledgeDocument(
    knowledgeBaseId: string,
    documentId: string
  ): Promise<KnowledgeDocumentListItem> {
    await this.ensureKnowledgeBaseExists(knowledgeBaseId);
    const document = await this.findKnowledgeDocument(knowledgeBaseId, documentId);

    if (!isTextDocument(document.originalFilename)) {
      throw new AppError(
        ErrorCodes.knowledge.invalidDocument,
        "only text documents can be reindexed now"
      );
    }

    const buffer = await readFile(document.storagePath);
    const processingDocument = await this.prisma.knowledgeDocument.update({
      where: {
        id: document.id
      },
      data: {
        status: "pending",
        errorMessage: null
      }
    });

    await this.prisma.knowledgeChunk.updateMany({
      where: {
        documentId: document.id,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    // 重新索引前先删除旧 embedding，避免旧向量继续参与后续检索。
    await this.deleteEmbeddingsForDocument(document.id);

    return this.indexTextDocument(processingDocument, buffer);
  }

  private async indexTextDocument(
    document: Prisma.KnowledgeDocumentGetPayload<object>,
    buffer: Buffer
  ): Promise<KnowledgeDocumentListItem> {
    try {
      await this.updateDocumentIndexStatus(document.id, "parsing");
      const text = parseTextDocument(document.originalFilename, buffer);
      await this.updateDocumentIndexStatus(document.id, "chunking");
      const chunks = chunkText(text);

      if (chunks.length === 0) {
        throw new Error("document text is empty");
      }

      // 文本解析和 chunk 写入必须在同一个事务中完成，避免文档显示已索引但 chunks 缺失。
      await this.prisma.$transaction([
        this.prisma.knowledgeChunk.createMany({
          data: chunks.map((chunk) => ({
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            metadata: this.toPrismaJson({
              parser: "text",
              source: document.originalFilename
            })
          }))
        }),
        this.prisma.knowledgeDocument.update({
          where: {
            id: document.id
          },
          data: {
            status: "chunking",
            errorMessage: null,
            chunkCount: chunks.length,
            indexedAt: null
          }
        })
      ]);

      const storedChunks = await this.prisma.knowledgeChunk.findMany({
        where: {
          documentId: document.id,
          deletedAt: null
        },
        orderBy: {
          chunkIndex: "asc"
        }
      });
      await this.updateDocumentIndexStatus(document.id, "embedding");
      await this.createEmbeddingsForChunks(document.knowledgeBaseId, storedChunks);

      const indexedDocument = await this.prisma.knowledgeDocument.update({
        where: {
          id: document.id
        },
        data: {
          status: "indexed",
          errorMessage: null,
          chunkCount: storedChunks.length,
          indexedAt: new Date()
        }
      });

      return this.toKnowledgeDocumentListItem(indexedDocument);
    } catch (error) {
      await this.cleanupDocumentIndex(document.id);
      const failedDocument = await this.prisma.knowledgeDocument.update({
        where: {
          id: document.id
        },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "document indexing failed",
          chunkCount: 0,
          indexedAt: null
        }
      });

      return this.toKnowledgeDocumentListItem(failedDocument);
    }
  }

  private async createEmbeddingsForChunks(
    knowledgeBaseId: string,
    chunks: Array<Prisma.KnowledgeChunkGetPayload<object>>
  ): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const { embeddingModelConfigId, embeddingDimension } =
      await this.getKnowledgeBaseEmbeddingConfig(knowledgeBaseId);
    const response = await this.modelProvidersService.createEmbedding({
      modelConfigId: embeddingModelConfigId,
      input: chunks.map((chunk) => chunk.content)
    });

    // embedding 必须和 chunk 顺序一一对应，后续写入时按同一索引绑定 chunkId。
    if (response.embeddings.length !== chunks.length) {
      throw new Error("embedding response count does not match chunk count");
    }

    // Embedding 模型维度一旦和知识库维度不一致，后续检索也无法混用，因此索引阶段直接失败并提示配置问题。
    const invalidEmbedding = response.embeddings.find(
      (embedding) => embedding.length !== embeddingDimension
    );

    if (invalidEmbedding) {
      throw new Error(
        `Embedding 向量维度不匹配：当前知识库需要 ${embeddingDimension} 维，但模型返回 ${invalidEmbedding.length} 维。请为知识库选择 ${embeddingDimension} 维 Embedding 模型，或创建新知识库后重新上传。`
      );
    }

    for (const [index, embedding] of response.embeddings.entries()) {
      const chunk = chunks[index];

      await this.insertKnowledgeEmbedding({
        knowledgeBaseId,
        chunkId: chunk.id,
        embeddingModelConfigId,
        embeddingDimension,
        embedding
      });
    }
  }

  private async updateDocumentIndexStatus(
    documentId: string,
    status: KnowledgeDocumentStatus
  ): Promise<void> {
    // 文档索引仍是同步执行，但细分状态便于后续异步任务和前端排查卡在哪个阶段。
    await this.prisma.knowledgeDocument.update({
      where: {
        id: documentId
      },
      data: {
        status
      }
    });
  }

  private async getKnowledgeBaseEmbeddingConfig(
    knowledgeBaseId: string
  ): Promise<{ embeddingModelConfigId: string; embeddingDimension: number }> {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        deletedAt: null
      },
      select: {
        embeddingModelConfigId: true,
        embeddingDimension: true
      }
    });

    if (!knowledgeBase) {
      throw new AppError(
        ErrorCodes.knowledge.notFound,
        "knowledge base not found",
        HttpStatus.NOT_FOUND
      );
    }

    return knowledgeBase;
  }

  private async insertKnowledgeEmbedding({
    knowledgeBaseId,
    chunkId,
    embeddingModelConfigId,
    embeddingDimension,
    embedding
  }: {
    knowledgeBaseId: string;
    chunkId: string;
    embeddingModelConfigId: string;
    embeddingDimension: number;
    embedding: number[];
  }): Promise<void> {
    const embeddingLiteral = `[${embedding.join(",")}]`;
    const tableName = this.getEmbeddingTableName(embeddingDimension);

    // Prisma 不能直接写 Unsupported("vector") 字段；表名只能来自白名单函数，避免 raw SQL 注入风险。
    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "${tableName}" (
          "id",
          "knowledge_base_id",
          "chunk_id",
          "embedding_model_config_id",
          "embedding"
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::vector)`,
        randomUUID(),
        knowledgeBaseId,
        chunkId,
        embeddingModelConfigId,
        embeddingLiteral
      );
    } catch (error) {
      throw this.toReadableEmbeddingError(error);
    }
  }

  private toReadableEmbeddingError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const dimensionMatch = message.match(/expected\s+(\d+)\s+dimensions,\s+not\s+(\d+)/iu);

    if (dimensionMatch) {
      return new Error(
        `Embedding 向量维度不匹配：当前知识库需要 ${dimensionMatch[1]} 维，但模型返回 ${dimensionMatch[2]} 维。请更换匹配维度的 Embedding 模型，或创建新知识库后重新上传。`
      );
    }

    return error instanceof Error ? error : new Error(message);
  }

  private async cleanupDocumentIndex(documentId: string): Promise<void> {
    // 索引失败时清理半成品，保证 failed 文档不会留下可检索的脏 chunk/embedding。
    await this.deleteEmbeddingsForDocument(documentId);
    await this.prisma.knowledgeChunk.updateMany({
      where: {
        documentId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });
  }

  private async deleteEmbeddingsForDocument(documentId: string): Promise<void> {
    // 迁移期间同时清理旧表和新分表；等旧表下线后只保留分表清理即可。
    await this.prisma.knowledgeEmbedding.deleteMany({
      where: {
        chunk: {
          documentId
        }
      }
    });

    for (const tableName of ["knowledge_embeddings_1024", "knowledge_embeddings_1536"]) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "${tableName}" e
         USING "knowledge_chunks" c
         WHERE c."id" = e."chunk_id"
           AND c."document_id" = $1::uuid`,
        documentId
      );
    }
  }

  private async findKnowledgeDocument(
    knowledgeBaseId: string,
    documentId: string
  ): Promise<Prisma.KnowledgeDocumentGetPayload<object>> {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        deletedAt: null
      }
    });

    if (!document) {
      throw new AppError(
        ErrorCodes.knowledge.documentNotFound,
        "knowledge document not found",
        HttpStatus.NOT_FOUND
      );
    }

    return document;
  }

  async ensureKnowledgeBaseIdsExist(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const existing = await this.prisma.knowledgeBase.findMany({
      where: {
        id: {
          in: ids
        },
        enabled: true,
        deletedAt: null
      },
      select: {
        id: true
      }
    });
    const existingIds = new Set(existing.map((item) => item.id));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      throw new AppError(
        ErrorCodes.agent.invalidKnowledgeBases,
        `unknown or disabled knowledgeBaseIds: ${missingIds.join(", ")}`
      );
    }
  }

  async getRetrievalConfigs(ids: string[]): Promise<KnowledgeBaseRetrievalConfig[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.prisma.knowledgeBase.findMany({
      where: {
        id: {
          in: ids
        },
        enabled: true,
        deletedAt: null
      },
      select: {
        id: true,
        embeddingModelConfigId: true,
        embeddingDimension: true
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

  private normalizeDocumentStatus(value: string): string {
    const status = value.trim();

    if (!KNOWLEDGE_DOCUMENT_STATUSES.includes(status as KnowledgeDocumentStatus)) {
      throw new AppError(ErrorCodes.common.badRequest, "status is invalid");
    }

    return status;
  }

  private validateUploadedDocument(file: UploadedKnowledgeFile | undefined): Required<UploadedKnowledgeFile> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new AppError(ErrorCodes.knowledge.invalidDocument, "file is required");
    }

    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      throw new AppError(
        ErrorCodes.knowledge.invalidDocument,
        "file size cannot exceed 20MB"
      );
    }

    const extension = extname(file.originalname).toLowerCase();

    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new AppError(
        ErrorCodes.knowledge.invalidDocument,
        "only txt, md, pdf, docx, csv, and json files are supported"
      );
    }

    return {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer
    };
  }

  private createStoredFilename(documentId: string, originalFilename: string): string {
    const extension = extname(originalFilename).toLowerCase() || ".bin";
    const safeBaseName =
      basename(originalFilename, extension).replace(/[^a-zA-Z0-9._-]/gu, "_") || "document";

    return `${documentId}-${safeBaseName}${extension}`;
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
      embeddingDimension: knowledgeBase.embeddingDimension,
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

  private toKnowledgeDocumentListItem(
    document: Prisma.KnowledgeDocumentGetPayload<object>
  ): KnowledgeDocumentListItem {
    return {
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      filename: document.filename,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      fileSize: document.fileSize.toString(),
      status: this.toKnowledgeDocumentStatus(document.status),
      errorMessage: document.errorMessage,
      chunkCount: document.chunkCount,
      indexedAt: document.indexedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    };
  }

  private toPrismaJson(value: Record<string, string>): Prisma.InputJsonValue {
    return value;
  }

  private getEmbeddingTableName(embeddingDimension: number): string {
    if (embeddingDimension === 1024) {
      return "knowledge_embeddings_1024";
    }

    if (embeddingDimension === 1536) {
      return "knowledge_embeddings_1536";
    }

    throw new Error(`暂不支持 ${embeddingDimension} 维 Embedding 向量表`);
  }

  private toKnowledgeDocumentStatus(status: string): KnowledgeDocumentStatus {
    if (KNOWLEDGE_DOCUMENT_STATUSES.includes(status as KnowledgeDocumentStatus)) {
      return status as KnowledgeDocumentStatus;
    }

    return "failed";
  }
}
