import { Injectable } from "@nestjs/common";

import { KnowledgeService } from "../knowledge/knowledge.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { PrismaService } from "../prisma/prisma.service";
import { RetrievalContext, RetrievalSource } from "./dto/retrieval.dto";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 12;

type RetrievalRow = {
  knowledge_base_id: string;
  document_id: string;
  document_name: string;
  chunk_id: string;
  chunk_index: number;
  content: string;
  score: number;
};

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledgeService: KnowledgeService,
    private readonly modelProvidersService: ModelProvidersService
  ) {}

  async retrieveKnowledgeContext({
    query,
    knowledgeBaseIds,
    topK = DEFAULT_TOP_K
  }: {
    query: string;
    knowledgeBaseIds: string[];
    topK?: number;
  }): Promise<RetrievalContext> {
    const startedAt = Date.now();
    const normalizedQuery = query.trim();

    if (!normalizedQuery || knowledgeBaseIds.length === 0) {
      return {
        query: normalizedQuery,
        sources: [],
        elapsedMs: Date.now() - startedAt
      };
    }

    const retrievalConfigs = await this.knowledgeService.getRetrievalConfigs(knowledgeBaseIds);

    if (retrievalConfigs.length === 0) {
      return {
        query: normalizedQuery,
        sources: [],
        elapsedMs: Date.now() - startedAt
      };
    }

    // v1 要求一个 Agent 绑定的知识库使用同一种 embedding model，避免不同向量空间混查。
    const embeddingModelConfigId = retrievalConfigs[0].embeddingModelConfigId;
    const compatibleKnowledgeBaseIds = retrievalConfigs
      .filter((config) => config.embeddingModelConfigId === embeddingModelConfigId)
      .map((config) => config.id);
    const queryEmbedding = await this.modelProvidersService.createEmbedding({
      modelConfigId: embeddingModelConfigId,
      input: normalizedQuery
    });
    const embedding = queryEmbedding.embeddings[0];

    if (!embedding) {
      return {
        query: normalizedQuery,
        sources: [],
        elapsedMs: Date.now() - startedAt
      };
    }

    const sources = await this.searchSimilarChunks({
      embedding,
      knowledgeBaseIds: compatibleKnowledgeBaseIds,
      topK: this.normalizeTopK(topK)
    });

    return {
      query: normalizedQuery,
      sources,
      elapsedMs: Date.now() - startedAt
    };
  }

  private async searchSimilarChunks({
    embedding,
    knowledgeBaseIds,
    topK
  }: {
    embedding: number[];
    knowledgeBaseIds: string[];
    topK: number;
  }): Promise<RetrievalSource[]> {
    if (knowledgeBaseIds.length === 0) {
      return [];
    }

    const embeddingLiteral = `[${embedding.join(",")}]`;
    // pgvector 相似度查询需要直接使用 <=> 操作符，Prisma 暂不支持这种 vector 表达式。
    const rows = await this.prisma.$queryRawUnsafe<RetrievalRow[]>(
      `SELECT
        c."knowledge_base_id",
        c."document_id",
        d."original_filename" AS "document_name",
        c."id" AS "chunk_id",
        c."chunk_index",
        c."content",
        1 - (e."embedding" <=> $1::vector) AS "score"
      FROM "knowledge_embeddings" e
      INNER JOIN "knowledge_chunks" c ON c."id" = e."chunk_id"
      INNER JOIN "knowledge_documents" d ON d."id" = c."document_id"
      WHERE c."deleted_at" IS NULL
        AND d."deleted_at" IS NULL
        AND c."knowledge_base_id" = ANY($2::uuid[])
      ORDER BY e."embedding" <=> $1::vector
      LIMIT $3`,
      embeddingLiteral,
      knowledgeBaseIds,
      topK
    );

    return rows.map((row) => ({
      knowledgeBaseId: row.knowledge_base_id,
      documentId: row.document_id,
      documentName: row.document_name,
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: Number(row.score)
    }));
  }

  private normalizeTopK(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      return DEFAULT_TOP_K;
    }

    return Math.min(value, MAX_TOP_K);
  }
}
