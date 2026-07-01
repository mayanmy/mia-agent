import { Inject, Injectable } from "@nestjs/common";

import { KnowledgeService } from "../knowledge/knowledge.service";
import { VECTOR_STORE, VectorIndexNamespace, VectorStore } from "../knowledge/vector-store";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { RetrievalContext, RetrievalSource } from "./dto/retrieval.dto";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 12;

@Injectable()
export class RetrievalService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly modelProvidersService: ModelProvidersService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
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
        ...(await Promise.all(
          group.knowledgeBases.map((knowledgeBase) =>
            this.vectorStore.search({
              namespace: knowledgeBase.namespace,
              embedding,
              embeddingDimension: group.embeddingDimension,
              embeddingModelConfigId: group.embeddingModelConfigId,
              knowledgeBaseIds: [knowledgeBase.id],
              topK: normalizedTopK
            })
          )
        )).flat()
      );
    }

    return {
      query: normalizedQuery,
      sources: sources.sort((left, right) => right.score - left.score).slice(0, normalizedTopK),
      elapsedMs: Date.now() - startedAt
    };
  }

  private groupRetrievalConfigs(
    configs: Array<{
      id: string;
      embeddingModelConfigId: string;
      embeddingDimension: number;
      vectorStoreType: "PGVECTOR";
      vectorCollectionName: string;
    }>
  ): Array<{
    embeddingModelConfigId: string;
    embeddingDimension: number;
    knowledgeBases: Array<{ id: string; namespace: VectorIndexNamespace }>;
  }> {
    const groups = new Map<
      string,
      {
        embeddingModelConfigId: string;
        embeddingDimension: number;
        knowledgeBases: Array<{ id: string; namespace: VectorIndexNamespace }>;
      }
    >();

    for (const config of configs) {
      const existing = groups.get(config.embeddingModelConfigId);
      const knowledgeBase = {
        id: config.id,
        namespace: {
          type: config.vectorStoreType,
          name: config.vectorCollectionName
        } satisfies VectorIndexNamespace
      };

      if (!existing) {
        groups.set(config.embeddingModelConfigId, {
          embeddingModelConfigId: config.embeddingModelConfigId,
          embeddingDimension: config.embeddingDimension,
          knowledgeBases: [knowledgeBase]
        });
        continue;
      }

      if (existing.embeddingDimension !== config.embeddingDimension) {
        throw new Error(
          `Embedding 向量维度不匹配：同一个 Embedding 模型绑定了 ${existing.embeddingDimension} 维和 ${config.embeddingDimension} 维知识库，请重建配置异常的知识库。`
        );
      }

      existing.knowledgeBases.push(knowledgeBase);
    }

    return [...groups.values()];
  }

  private normalizeTopK(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      return DEFAULT_TOP_K;
    }

    return Math.min(value, MAX_TOP_K);
  }
}
