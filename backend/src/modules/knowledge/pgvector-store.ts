import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../prisma/prisma.service";
import {
  VectorStore,
  VectorStoreSearchInput,
  VectorStoreSearchResult,
  VectorStoreUpsertEmbeddingInput
} from "./vector-store";

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
export class PgvectorVectorStore implements VectorStore {
  constructor(private readonly prisma: PrismaService) {}

  async upsertEmbedding(input: VectorStoreUpsertEmbeddingInput): Promise<void> {
    this.ensurePgvectorNamespace(input.namespace.name);
    const embeddingLiteral = `[${input.embedding.join(",")}]`;
    const tableName = this.getEmbeddingTableName(input.embeddingDimension);

    // Prisma 目前不能直接写 Unsupported("vector") 字段，所以这里仍然使用 raw SQL。
    // raw SQL 中唯一动态部分是表名，而表名只来自维度白名单，不能从用户输入直接拼接。
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${tableName}" (
        "id",
        "knowledge_base_id",
        "chunk_id",
        "embedding_model_config_id",
        "embedding"
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::vector)
      ON CONFLICT ("chunk_id") DO UPDATE SET
        "embedding_model_config_id" = EXCLUDED."embedding_model_config_id",
        "embedding" = EXCLUDED."embedding"`,
      randomUUID(),
      input.knowledgeBaseId,
      input.chunkId,
      input.embeddingModelConfigId,
      embeddingLiteral
    );
  }

  async deleteDocument({
    namespace,
    documentId
  }: {
    namespace: { type: "PGVECTOR"; name: string } | null;
    documentId: string;
  }): Promise<void> {
    if (namespace) {
      this.ensurePgvectorNamespace(namespace.name);
    }

    // 迁移期间同时清理旧表和所有 pgvector 分表。删除要保持幂等：重复执行不会改变最终结果。
    await this.prisma.knowledgeEmbedding.deleteMany({
      where: {
        chunk: {
          documentId
        }
      }
    });

    for (const tableName of [
      "knowledge_embeddings_1024",
      "knowledge_embeddings_1536",
      "knowledge_embeddings_3072"
    ]) {
      await this.prisma.$executeRawUnsafe(
        `DELETE FROM "${tableName}" e
         USING "knowledge_chunks" c
         WHERE c."id" = e."chunk_id"
           AND c."document_id" = $1::uuid`,
        documentId
      );
    }
  }

  async search(input: VectorStoreSearchInput): Promise<VectorStoreSearchResult[]> {
    this.ensurePgvectorNamespace(input.namespace.name);

    if (input.knowledgeBaseIds.length === 0) {
      return [];
    }

    const embeddingLiteral = `[${input.embedding.join(",")}]`;
    const tableName = this.getEmbeddingTableName(input.embeddingDimension);

    // pgvector 相似度查询需要直接使用 <=> 操作符；namespace 目前用于表达知识库级索引边界，
    // pgvector 轻量实现仍通过 knowledge_base_id 过滤，后续切 Qdrant 时会映射到 collection。
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
      input.knowledgeBaseIds,
      input.embeddingModelConfigId,
      input.topK
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

  private ensurePgvectorNamespace(namespaceName: string): void {
    // 这里先只校验命名空间格式，不把 namespace 映射到独立表。
    // 这样业务层已经按“一个知识库一个向量命名空间”建模，后续 Qdrant 可直接把它变成 collection 名。
    if (!/^kb_[0-9a-f-]{36}$/iu.test(namespaceName)) {
      throw new Error(`非法 pgvector 知识库向量命名空间：${namespaceName}`);
    }
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

