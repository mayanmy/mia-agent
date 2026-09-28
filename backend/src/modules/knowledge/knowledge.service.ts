import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ModelConfigType, Prisma, WorkspaceRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { getConfig } from "../../core/config";
import { AppError, ErrorCodes } from "../../core/errors";
import { getWorkspaceId, requireWorkspaceId } from "../../core/auth/workspace-context";
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
  KnowledgeKeywordSearchRequest,
  KnowledgeKeywordSearchResult,
  KnowledgeDocumentStatus,
  KnowledgeDocumentListItem,
  KnowledgeDocumentQueryDto,
  UploadedKnowledgeFile
} from "./dto/knowledge.dto";
import { chunkText } from "./chunking";
import { isTextDocument, parseTextDocument } from "./parsing";
import { VECTOR_STORE, VectorIndexNamespace, VectorStore } from "./vector-store";

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
const KEYWORD_QUERY_MAX_LENGTH = 1_000;
const KEYWORD_CANDIDATE_MAX_LIMIT = 100;
const KEYWORD_QUERY_TIMEOUT_MS = 2_000;

type KeywordRetrievalRow = {
  knowledge_base_id: string;
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  score: number;
};

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
    private readonly modelProvidersService: ModelProvidersService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
  ) {}

  async listKnowledgeBases(
    query: KnowledgeBaseQueryDto,
    workspaceRole?: WorkspaceRole
  ): Promise<PageResult<KnowledgeBaseListItem>> {
    const page = normalizePageQuery(query);
    const where: Prisma.KnowledgeBaseWhereInput = {
      workspaceId: requireWorkspaceId(),
      deletedAt: null,
      ...(workspaceRole === WorkspaceRole.MEMBER ? { enabled: true } : {}),
      ...(query.enabled !== undefined ? { enabled: this.parseEnabled(query.enabled) } : {})
    };

    // 列表与总数共用同一事务快照，避免文档索引状态更新造成分页口径漂移。
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
    const knowledgeBaseId = randomUUID();

    const knowledgeBase = await this.prisma.knowledgeBase.create({
      // 知识库创建时锁定向量维度和向量命名空间。
      // 当前 vector_store_type 仍是 PGVECTOR，但 collectionName 已按知识库生成，后续切 Qdrant 时可直接映射为 Collection 名。
      data: {
        id: knowledgeBaseId,
        workspaceId: requireWorkspaceId(),
        ...data,
        embeddingDimension,
        vectorStoreType: "PGVECTOR",
        vectorCollectionName: this.createVectorCollectionName(knowledgeBaseId)
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
      where: { id, workspaceId: requireWorkspaceId() },
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
      where: { id, workspaceId: requireWorkspaceId() },
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
      workspaceId: requireWorkspaceId(),
      knowledgeBaseId,
      deletedAt: null,
      ...(query.status ? { status: this.normalizeDocumentStatus(query.status) } : {})
    };

    // 文档列表和总数共用同一事务快照，确保后台索引更新期间分页结果自洽。
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
    file: UploadedKnowledgeFile | undefined,
    encodedOriginalFilename?: string
  ): Promise<KnowledgeDocumentListItem> {
    await this.ensureKnowledgeBaseExists(knowledgeBaseId);
    const normalizedFile = this.validateUploadedDocument(file, encodedOriginalFilename);
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
          workspaceId: requireWorkspaceId(),
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
        workspaceId: requireWorkspaceId(),
        knowledgeBaseId,
        deletedAt: null
      },
      select: {
        id: true,
        knowledgeBase: {
          select: {
            vectorStoreType: true,
            vectorCollectionName: true
          }
        }
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
    await this.deleteEmbeddingsForDocument(
      documentId,
      this.toVectorNamespace(existing.knowledgeBase)
    );

    // 文档与切片采用软删除，二者必须同时提交，避免已删除文档的 chunk 继续参与业务查询。
    await this.prisma.$transaction([
      this.prisma.knowledgeDocument.update({
        where: {
          id: documentId,
          workspaceId: requireWorkspaceId()
        },
        data: {
          deletedAt,
          status: "deleted"
        }
      }),
      this.prisma.knowledgeChunk.updateMany({
        where: {
          documentId,
          workspaceId: requireWorkspaceId(),
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
        id: document.id,
        workspaceId: requireWorkspaceId()
      },
      data: {
        status: "pending",
        errorMessage: null
      }
    });

    await this.prisma.knowledgeChunk.updateMany({
      where: {
        documentId: document.id,
        workspaceId: document.workspaceId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    // 重新索引前先删除旧 embedding，避免旧向量继续参与后续检索。
    await this.deleteEmbeddingsForDocument(
      document.id,
      await this.getVectorNamespace(knowledgeBaseId)
    );

    const reindexedDocument = await this.indexTextDocument(processingDocument, buffer);

    if (reindexedDocument.status !== "indexed") {
      throw new AppError(
        ErrorCodes.knowledge.invalidDocument,
        reindexedDocument.errorMessage ?? "document reindex failed"
      );
    }

    return reindexedDocument;
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
            workspaceId: document.workspaceId,
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
            id: document.id,
            workspaceId: document.workspaceId
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
          workspaceId: document.workspaceId,
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

    const embeddingConfig = await this.getKnowledgeBaseEmbeddingConfig(knowledgeBaseId);
    const response = await this.modelProvidersService.createEmbedding({
      modelConfigId: embeddingConfig.embeddingModelConfigId,
      input: chunks.map((chunk) => chunk.content)
    });

    // embedding 必须和 chunk 顺序一一对应，后续写入时按同一索引绑定 chunkId。
    if (response.embeddings.length !== chunks.length) {
      throw new Error("embedding response count does not match chunk count");
    }

    const actualDimension = this.getConsistentEmbeddingDimension(response.embeddings);
    let embeddingDimension = embeddingConfig.embeddingDimension;

    if (actualDimension !== embeddingDimension) {
      embeddingDimension = await this.resolveEmbeddingDimensionMismatch({
        knowledgeBaseId,
        currentDocumentId: chunks[0].documentId,
        embeddingModelConfigId: embeddingConfig.embeddingModelConfigId,
        expectedDimension: embeddingDimension,
        actualDimension
      });
    }

    for (const [index, embedding] of response.embeddings.entries()) {
      const chunk = chunks[index];

      try {
        await this.vectorStore.upsertEmbedding({
          workspaceId: chunks[0].workspaceId,
          namespace: embeddingConfig.namespace,
          knowledgeBaseId,
          chunkId: chunk.id,
          embeddingModelConfigId: embeddingConfig.embeddingModelConfigId,
          embeddingDimension,
          embedding
        });
      } catch (error) {
        throw this.toReadableEmbeddingError(error);
      }
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

  private async getKnowledgeBaseEmbeddingConfig(knowledgeBaseId: string): Promise<{
    embeddingModelConfigId: string;
    embeddingDimension: number;
    namespace: VectorIndexNamespace;
  }> {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        deletedAt: null
      },
      select: {
        embeddingModelConfigId: true,
        embeddingDimension: true,
        vectorStoreType: true,
        vectorCollectionName: true
      }
    });

    if (!knowledgeBase) {
      throw new AppError(
        ErrorCodes.knowledge.notFound,
        "knowledge base not found",
        HttpStatus.NOT_FOUND
      );
    }

    return {
      embeddingModelConfigId: knowledgeBase.embeddingModelConfigId,
      embeddingDimension: knowledgeBase.embeddingDimension,
      namespace: this.toVectorNamespace(knowledgeBase)
    };
  }

  private getConsistentEmbeddingDimension(embeddings: number[][]): number {
    const firstEmbedding = embeddings[0];

    if (!firstEmbedding) {
      throw new Error("embedding response is empty");
    }

    const dimension = firstEmbedding.length;
    const mismatchedEmbedding = embeddings.find((embedding) => embedding.length !== dimension);

    if (mismatchedEmbedding) {
      throw new Error(
        `Embedding 向量维度不一致：同一次响应中同时出现 ${dimension} 维和 ${mismatchedEmbedding.length} 维。`
      );
    }

    return dimension;
  }

  private async resolveEmbeddingDimensionMismatch({
    knowledgeBaseId,
    currentDocumentId,
    embeddingModelConfigId,
    expectedDimension,
    actualDimension
  }: {
    knowledgeBaseId: string;
    currentDocumentId: string;
    embeddingModelConfigId: string;
    expectedDimension: number;
    actualDimension: number;
  }): Promise<number> {
    if (!this.isSupportedEmbeddingDimension(actualDimension)) {
      throw new Error(
        `暂不支持 ${actualDimension} 维 Embedding 向量表。当前可用维度为 1024、1536、3072，请更换 Embedding 模型或先扩展向量表。`
      );
    }

    const canAdjust = await this.canAdjustKnowledgeBaseEmbeddingDimension(
      knowledgeBaseId,
      currentDocumentId
    );

    if (!canAdjust) {
      throw new Error(
        `Embedding 向量维度不匹配：当前知识库需要 ${expectedDimension} 维，但模型返回 ${actualDimension} 维。请为知识库选择 ${expectedDimension} 维 Embedding 模型，或创建新知识库后重新上传。`
      );
    }

    // 这个分支只允许发生在知识库还没有成功索引过任何文档时。
    // 这种情况下旧维度只是创建知识库时的错误推断，直接修正知识库和模型配置，不会破坏已有向量空间。
    await this.prisma.knowledgeBase.update({
      where: {
        id: knowledgeBaseId
      },
      data: {
        embeddingDimension: actualDimension
      }
    });
    await this.modelProvidersService.updateDetectedEmbeddingDimension(
      embeddingModelConfigId,
      actualDimension
    );

    return actualDimension;
  }

  private async canAdjustKnowledgeBaseEmbeddingDimension(
    knowledgeBaseId: string,
    currentDocumentId: string
  ): Promise<boolean> {
    const indexedDocumentCount = await this.prisma.knowledgeDocument.count({
      where: {
        knowledgeBaseId,
        id: {
          not: currentDocumentId
        },
        status: "indexed",
        deletedAt: null
      }
    });

    return indexedDocumentCount === 0;
  }

  private isSupportedEmbeddingDimension(dimension: number): boolean {
    return dimension === 1024 || dimension === 1536 || dimension === 3072;
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
    await this.deleteEmbeddingsForDocument(documentId, null);
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

  private async deleteEmbeddingsForDocument(
    documentId: string,
    namespace: VectorIndexNamespace | null
  ): Promise<void> {
    await this.vectorStore.deleteDocument({
      namespace,
      documentId
    });
  }

  private async findKnowledgeDocument(
    knowledgeBaseId: string,
    documentId: string
  ): Promise<Prisma.KnowledgeDocumentGetPayload<object>> {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
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
        workspaceId: requireWorkspaceId(),
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

    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        id: {
          in: ids
        },
        enabled: true,
        deletedAt: null
      },
      select: {
        id: true,
        workspaceId: true,
        embeddingModelConfigId: true,
        embeddingDimension: true,
        vectorStoreType: true,
        vectorCollectionName: true
      }
    });

    return knowledgeBases.map((knowledgeBase) => ({
      id: knowledgeBase.id,
      workspaceId: knowledgeBase.workspaceId,
      embeddingModelConfigId: knowledgeBase.embeddingModelConfigId,
      embeddingDimension: knowledgeBase.embeddingDimension,
      vectorStoreType: this.toVectorNamespace(knowledgeBase).type,
      vectorCollectionName: knowledgeBase.vectorCollectionName
    }));
  }

  /**
   * 使用 PostgreSQL FTS + pg_trgm 执行关键词召回。
   *
   * `simple` FTS 适合英文、路径和错误码，trigram 补齐中文连续文本与无空格标识符；
   * 查询只允许命中已完成索引的文档，并通过数据库 statement_timeout 限制慢查询影响面。
   */
  async searchKeywordChunks({
    workspaceId,
    knowledgeBaseIds,
    query,
    limit
  }: KnowledgeKeywordSearchRequest): Promise<KnowledgeKeywordSearchResult[]> {
    const normalizedQuery = query.trim().slice(0, KEYWORD_QUERY_MAX_LENGTH);
    const normalizedLimit = Math.min(
      Math.max(Number.isInteger(limit) && limit > 0 ? limit : 1, 1),
      KEYWORD_CANDIDATE_MAX_LIMIT
    );

    if (!normalizedQuery || knowledgeBaseIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.$transaction(async (transaction) => {
      // SET LOCAL 仅在当前事务生效，避免一次异常查询污染连接池中的后续请求。
      await transaction.$queryRawUnsafe<Array<{ set_config: string }>>(
        "SELECT set_config('statement_timeout', $1, true)",
        String(KEYWORD_QUERY_TIMEOUT_MS)
      );

      return transaction.$queryRawUnsafe<KeywordRetrievalRow[]>(
        `WITH input AS (
          SELECT
            websearch_to_tsquery('simple', $3::text) AS ts_query,
            lower($3::text) AS normalized_query
        ), scored AS (
          SELECT
            c."knowledge_base_id",
            c."document_id",
            d."original_filename" AS "document_name",
            c."id" AS "chunk_id",
            c."chunk_index",
            c."content",
            ts_rank_cd(to_tsvector('simple', c."content"), input.ts_query, 32) AS fts_score,
            similarity(lower(c."content"), input.normalized_query) AS trigram_score,
            CASE
              WHEN strpos(lower(c."content"), input.normalized_query) > 0 THEN 1.0
              ELSE 0.0
            END AS exact_score
          FROM "knowledge_chunks" c
          INNER JOIN "knowledge_documents" d ON d."id" = c."document_id"
          CROSS JOIN input
          WHERE c."workspace_id" = $1::uuid
            AND d."workspace_id" = $1::uuid
            AND c."knowledge_base_id" = ANY($2::uuid[])
            AND c."deleted_at" IS NULL
            AND d."deleted_at" IS NULL
            AND d."status" = 'indexed'
            AND (
              to_tsvector('simple', c."content") @@ input.ts_query
              OR lower(c."content") % input.normalized_query
              OR strpos(lower(c."content"), input.normalized_query) > 0
            )
        )
        SELECT
          "knowledge_base_id",
          "document_id",
          "document_name",
          "chunk_id",
          "chunk_index",
          "content",
          LEAST(1.0, GREATEST(fts_score, trigram_score, exact_score))::double precision AS "score"
        FROM scored
        ORDER BY "score" DESC, "chunk_id" ASC
        LIMIT $4`,
        workspaceId,
        knowledgeBaseIds,
        normalizedQuery,
        normalizedLimit
      );
    });

    return rows.map((row) => ({
      knowledgeBaseId: row.knowledge_base_id,
      documentId: row.document_id,
      documentName: row.document_name,
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: Math.max(0, Math.min(1, Number(row.score)))
    }));
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

  private validateUploadedDocument(
    file: UploadedKnowledgeFile | undefined,
    encodedOriginalFilename?: string
  ): Required<UploadedKnowledgeFile> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new AppError(ErrorCodes.knowledge.invalidDocument, "file is required");
    }

    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      throw new AppError(ErrorCodes.knowledge.invalidDocument, "file size cannot exceed 20MB");
    }

    const originalname = this.resolveUploadedOriginalFilename(
      file.originalname,
      encodedOriginalFilename
    );
    const extension = extname(originalname).toLowerCase();

    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
      throw new AppError(
        ErrorCodes.knowledge.invalidDocument,
        "only txt, md, pdf, docx, csv, and json files are supported"
      );
    }

    return {
      originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer
    };
  }

  private resolveUploadedOriginalFilename(
    fallbackFilename: string,
    encodedOriginalFilename?: string
  ): string {
    if (encodedOriginalFilename) {
      try {
        const decodedFilename = decodeURIComponent(encodedOriginalFilename.trim());

        if (decodedFilename.trim()) {
          // 前端通过 X-File-Name 传递 encodeURIComponent 后的用户可见文件名。
          // 后端只把它作为数据库展示名来源，绝不直接用于磁盘路径。
          return basename(decodedFilename.trim());
        }
      } catch {
        // Header 可能来自旧客户端或手写请求，解码失败时回退到 multer 原始文件名兼容链路。
      }
    }

    return basename(this.normalizeUploadedFilename(fallbackFilename));
  }

  private normalizeUploadedFilename(filename: string): string {
    const trimmedFilename = filename.trim();

    if (!trimmedFilename) {
      return filename;
    }

    const decodedFilename = Buffer.from(trimmedFilename, "latin1").toString("utf8");

    // multipart 文件名有时会被 multer 按 latin1 暴露，中文会显示成 å、ç、æ 这类乱码。
    // 只有在“转回 UTF-8 后明显更像正常文件名”时才替换，避免误伤正常英文文件名。
    if (
      this.getFilenameDecodeScore(decodedFilename) > this.getFilenameDecodeScore(trimmedFilename)
    ) {
      return decodedFilename;
    }

    return trimmedFilename;
  }

  private getFilenameDecodeScore(filename: string): number {
    let score = 0;

    if (/[\u4e00-\u9fff]/u.test(filename)) {
      score += 3;
    }

    if ([...filename].some((character) => character.charCodeAt(0) > 127)) {
      score += 1;
    }

    if (/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîï]/u.test(filename)) {
      score -= 2;
    }

    if (filename.includes("�")) {
      score -= 4;
    }

    return score;
  }

  private createStoredFilename(documentId: string, originalFilename: string): string {
    const extension = extname(originalFilename).toLowerCase() || ".bin";

    // 物理存储名只使用系统生成 ID，用户文件名只进入数据库展示字段，彻底避开中文和特殊字符路径兼容问题。
    return `${documentId}${extension}`;
  }

  private async ensureNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: {
        workspaceId: requireWorkspaceId(),
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
        workspaceId: requireWorkspaceId(),
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
        workspaceId: requireWorkspaceId(),
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
      vectorStoreType: this.toVectorNamespace(knowledgeBase).type,
      vectorCollectionName: knowledgeBase.vectorCollectionName,
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

  private async getVectorNamespace(knowledgeBaseId: string): Promise<VectorIndexNamespace> {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        deletedAt: null
      },
      select: {
        vectorStoreType: true,
        vectorCollectionName: true
      }
    });

    if (!knowledgeBase) {
      throw new AppError(
        ErrorCodes.knowledge.notFound,
        "knowledge base not found",
        HttpStatus.NOT_FOUND
      );
    }

    return this.toVectorNamespace(knowledgeBase);
  }

  private toVectorNamespace(knowledgeBase: {
    vectorStoreType: string;
    vectorCollectionName: string;
  }): VectorIndexNamespace {
    if (knowledgeBase.vectorStoreType !== "PGVECTOR") {
      throw new Error(`暂不支持 ${knowledgeBase.vectorStoreType} 向量存储`);
    }

    return {
      type: "PGVECTOR",
      name: knowledgeBase.vectorCollectionName
    };
  }

  private createVectorCollectionName(knowledgeBaseId: string): string {
    return `kb_${knowledgeBaseId}`;
  }

  private toKnowledgeDocumentStatus(status: string): KnowledgeDocumentStatus {
    if (KNOWLEDGE_DOCUMENT_STATUSES.includes(status as KnowledgeDocumentStatus)) {
      return status as KnowledgeDocumentStatus;
    }

    return "failed";
  }
}
