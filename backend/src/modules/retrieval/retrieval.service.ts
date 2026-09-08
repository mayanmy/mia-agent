import { Inject, Injectable } from "@nestjs/common";

import { KnowledgeService } from "../knowledge/knowledge.service";
import { VECTOR_STORE, VectorIndexNamespace, VectorStore } from "../knowledge/vector-store";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import {
  RetrievalContext,
  RetrievalSource,
  RetrieveKnowledgeContextRequest
} from "./dto/retrieval.dto";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 12;

@Injectable()
export class RetrievalService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly modelProvidersService: ModelProvidersService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
  ) {}

  /** 执行可取消的知识检索，并在跨知识库合并后统一应用分数阈值和 Top K。 */
  async retrieveKnowledgeContext({
    query,
    knowledgeBaseIds,
    topK = DEFAULT_TOP_K,
    scoreThreshold,
    signal
  }: RetrieveKnowledgeContextRequest): Promise<RetrievalContext> {
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
      this.throwIfAborted(signal);
      const queryEmbedding = await this.modelProvidersService.createEmbedding({
        modelConfigId: group.embeddingModelConfigId,
        input: normalizedQuery,
        signal
      });
      this.throwIfAborted(signal);
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
        ...(
          await Promise.all(
            group.knowledgeBases.map((knowledgeBase) =>
              this.vectorStore.search({
                workspaceId: group.workspaceId,
                namespace: knowledgeBase.namespace,
                embedding,
                embeddingDimension: group.embeddingDimension,
                embeddingModelConfigId: group.embeddingModelConfigId,
                knowledgeBaseIds: [knowledgeBase.id],
                topK: normalizedTopK
              })
            )
          )
        ).flat()
      );
      this.throwIfAborted(signal);
    }

    const normalizedScoreThreshold = this.normalizeScoreThreshold(scoreThreshold);
    return {
      query: normalizedQuery,
      sources: sources
        .filter(
          (source) =>
            normalizedScoreThreshold === undefined || source.score >= normalizedScoreThreshold
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, normalizedTopK),
      elapsedMs: Date.now() - startedAt
    };
  }

  private groupRetrievalConfigs(
    configs: Array<{
      id: string;
      workspaceId: string;
      embeddingModelConfigId: string;
      embeddingDimension: number;
      vectorStoreType: "PGVECTOR";
      vectorCollectionName: string;
    }>
  ): Array<{
    workspaceId: string;
    embeddingModelConfigId: string;
    embeddingDimension: number;
    knowledgeBases: Array<{ id: string; namespace: VectorIndexNamespace }>;
  }> {
    const groups = new Map<
      string,
      {
        workspaceId: string;
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
          workspaceId: config.workspaceId,
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

      if (existing.workspaceId !== config.workspaceId) {
        throw new Error("禁止跨项目空间合并知识库检索");
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

  /** scoreThreshold 由 Workflow Executor 校验；其他调用方传入异常值时忽略而非误删全部结果。 */
  private normalizeScoreThreshold(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : undefined;
  }

  /** Prisma 查询暂不能主动取消，但每个外部阶段前后检查 Signal，阻止继续发起后续检索。 */
  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const error = new Error("retrieval canceled");
    error.name = "AbortError";
    throw error;
  }
}
