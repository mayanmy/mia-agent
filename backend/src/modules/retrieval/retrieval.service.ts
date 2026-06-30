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

    const normalizedTopK = this.normalizeTopK(topK);
    const sources: RetrievalSource[] = [];

    // 不同 Embedding 模型处于不同向量空间，即使维度相同也不能混查，所以按模型配置分组检索。
    for (const group of this.groupRetrievalConfigs(retrievalConfigs)) {
      const queryEmbedding = await this.modelProvidersService.createEmbedding({
        modelConfigId: group.embeddingModelConfigId,
        input: normalizedQuery
      });
      const embedding = queryEmbedding.embeddings[0];

      if (!embedding) {
        continue;
      }

      if (embedding.length !== group.embeddingDimension) {
        throw new Error(
          `Embedding 向量维度不匹配：当前知识库需要 ${group.embeddingDimension} 维，但模型返回 ${embedding.length} 维。请检查知识库的 Embedding 模型配置。`
        );
      }

      sources.push(
        ...(await this.searchSimilarChunks({
          embedding,
          embeddingDimension: group.embeddingDimension,
          embeddingModelConfigId: group.embeddingModelConfigId,
          knowledgeBaseIds: group.knowledgeBaseIds,
          topK: normalizedTopK
        }))
      );
    }

    return {
      query: normalizedQuery,
      sources: sources.sort((left, right) => right.score - left.score).slice(0, normalizedTopK),
      elapsedMs: Date.now() - startedAt
    };
  }

  private groupRetrievalConfigs(
    configs: Array<{ id: string; embeddingModelConfigId: string; embeddingDimension: number }>
  ): Array<{
    embeddingModelConfigId: string;
    embeddingDimension: number;
    knowledgeBaseIds: string[];
  }> {
    const groups = new Map<
      string,
      { embeddingModelConfigId: string; embeddingDimension: number; knowledgeBaseIds: string[] }
    >();

    for (const config of configs) {
      const existing = groups.get(config.embeddingModelConfigId);

      if (!existing) {
        groups.set(config.embeddingModelConfigId, {
          embeddingModelConfigId: config.embeddingModelConfigId,
          embeddingDimension: config.embeddingDimension,
          knowledgeBaseIds: [config.id]
        });
        continue;
      }

      if (existing.embeddingDimension !== config.embeddingDimension) {
        throw new Error(
          `Embedding 向量维度不匹配：同一个 Embedding 模型绑定了 ${existing.embeddingDimension} 维和 ${config.embeddingDimension} 维知识库，请重建配置异常的知识库。`
        );
      }

      existing.knowledgeBaseIds.push(config.id);
    }

    return [...groups.values()];
  }

  private async searchSimilarChunks({
    embedding,
    embeddingDimension,
    embeddingModelConfigId,
    knowledgeBaseIds,
    topK
  }: {
    embedding: number[];
    embeddingDimension: number;
    embeddingModelConfigId: string;
    knowledgeBaseIds: string[];
    topK: number;
  }): Promise<RetrievalSource[]> {
    if (knowledgeBaseIds.length === 0) {
      return [];
    }

    const embeddingLiteral = `[${embedding.join(",")}]`;
    const tableName = this.getEmbeddingTableName(embeddingDimension);
    // pgvector 相似度查询需要直接使用 <=> 操作符；表名只来自维度白名单，不能使用用户输入拼接。
    const rows = await this.prisma.$queryRawUnsafe<RetrievalRow[]>(
      `SELECT
        c."knowledge_base_id",
        c."document_id",
        d."original_filename" AS "document_name",
        c."id" AS "chunk_id",
        c."chunk_index",
        c."content",
        1 - (e."embedding" <=> $1::vector) AS "score"
      FROM "${tableName}" e
      INNER JOIN "knowledge_chunks" c ON c."id" = e."chunk_id"
      INNER JOIN "knowledge_documents" d ON d."id" = c."document_id"
      WHERE c."deleted_at" IS NULL
        AND d."deleted_at" IS NULL
        AND c."knowledge_base_id" = ANY($2::uuid[])
        AND e."embedding_model_config_id" = $3::uuid
      ORDER BY e."embedding" <=> $1::vector
      LIMIT $4`,
      embeddingLiteral,
      knowledgeBaseIds,
      embeddingModelConfigId,
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

  private getEmbeddingTableName(embeddingDimension: number): string {
    if (embeddingDimension === 1024) {
      return "knowledge_embeddings_1024";
    }

    if (embeddingDimension === 1536) {
      return "knowledge_embeddings_1536";
    }

    if (embeddingDimension === 3072) {
      return "knowledge_embeddings_3072";
    }

    throw new Error(`暂不支持 ${embeddingDimension} 维 Embedding 向量表`);
  }
}
