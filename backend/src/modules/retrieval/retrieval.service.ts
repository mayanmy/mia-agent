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
const MIN_CHANNEL_CANDIDATES = 20;
const MAX_CHANNEL_CANDIDATES = 60;
const CANDIDATE_MULTIPLIER = 4;
const RRF_K = 60;
const VECTOR_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;
const CONFIDENCE_WEIGHT = 0.75;
const FUSION_WEIGHT = 0.25;

type RetrievalCandidate = Omit<RetrievalSource, "matchedBy">;

type RetrievalConfig = {
  id: string;
  workspaceId: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
  vectorStoreType: "PGVECTOR";
  vectorCollectionName: string;
};

type RetrievalConfigGroup = {
  workspaceId: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
  knowledgeBases: Array<{ id: string; namespace: VectorIndexNamespace }>;
};

/** 配置损坏不能被关键词降级掩盖，否则管理员会长期使用不完整的知识索引。 */
class RetrievalConfigurationError extends Error {}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly modelProvidersService: ModelProvidersService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore
  ) {}

  /**
   * 并行执行向量语义召回和关键词召回，以加权 RRF 去重融合。
   * 单通道远程/数据库故障时保留可用结果；配置错误或双通道均失败时明确中止。
   */
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
      return { query: normalizedQuery, sources: [], elapsedMs: Date.now() - startedAt };
    }

    const retrievalConfigs = await this.knowledgeService.getRetrievalConfigs(knowledgeBaseIds);

    if (retrievalConfigs.length === 0) {
      return { query: normalizedQuery, sources: [], elapsedMs: Date.now() - startedAt };
    }

    const groups = this.groupRetrievalConfigs(retrievalConfigs);
    const workspaceId = groups[0]?.workspaceId;
    if (!workspaceId) throw new RetrievalConfigurationError("知识库缺少项目空间配置");

    const normalizedTopK = this.normalizeTopK(topK);
    const candidateLimit = Math.min(
      Math.max(normalizedTopK * CANDIDATE_MULTIPLIER, MIN_CHANNEL_CANDIDATES),
      MAX_CHANNEL_CANDIDATES
    );
    this.throwIfAborted(signal);

    // 关键词召回无需等待查询 Embedding，可与全部向量空间检索并行执行以降低尾延迟。
    const [vectorResult, keywordResult] = await Promise.allSettled([
      this.searchVectorCandidates(normalizedQuery, groups, candidateLimit, signal),
      this.knowledgeService.searchKeywordChunks({
        workspaceId,
        knowledgeBaseIds: retrievalConfigs.map((config) => config.id),
        query: normalizedQuery,
        limit: candidateLimit
      })
    ]);
    this.throwIfAborted(signal);

    if (
      vectorResult.status === "rejected" &&
      vectorResult.reason instanceof RetrievalConfigurationError
    ) {
      throw vectorResult.reason;
    }

    if (vectorResult.status === "rejected" && keywordResult.status === "rejected") {
      throw new AggregateError(
        [vectorResult.reason, keywordResult.reason],
        "向量检索和关键词检索均失败"
      );
    }

    const vectorCandidates = vectorResult.status === "fulfilled" ? vectorResult.value : [];
    const keywordCandidates = keywordResult.status === "fulfilled" ? keywordResult.value : [];
    const degradedChannels: Array<"vector" | "keyword"> = [];
    if (vectorResult.status === "rejected") degradedChannels.push("vector");
    if (keywordResult.status === "rejected") degradedChannels.push("keyword");

    const fusedSources = this.fuseCandidates(vectorCandidates, keywordCandidates);
    const normalizedScoreThreshold = this.normalizeScoreThreshold(scoreThreshold);

    return {
      query: normalizedQuery,
      sources: fusedSources
        .filter(
          (source) =>
            normalizedScoreThreshold === undefined || source.score >= normalizedScoreThreshold
        )
        .slice(0, normalizedTopK),
      elapsedMs: Date.now() - startedAt,
      diagnostics: {
        strategy: "hybrid_rrf",
        vectorCandidateCount: vectorCandidates.length,
        keywordCandidateCount: keywordCandidates.length,
        fusedCandidateCount: fusedSources.length,
        degradedChannels
      }
    };
  }

  /** 每个 Embedding 模型独立生成查询向量，最终再按分数合并候选。 */
  private async searchVectorCandidates(
    query: string,
    groups: RetrievalConfigGroup[],
    candidateLimit: number,
    signal?: AbortSignal
  ): Promise<RetrievalCandidate[]> {
    const sources: RetrievalCandidate[] = [];

    for (const group of groups) {
      this.throwIfAborted(signal);
      const queryEmbedding = await this.modelProvidersService.createEmbedding({
        modelConfigId: group.embeddingModelConfigId,
        input: query,
        signal
      });
      this.throwIfAborted(signal);
      const embedding = queryEmbedding.embeddings[0];

      if (!embedding) continue;
      if (embedding.length !== group.embeddingDimension) {
        throw new RetrievalConfigurationError(
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
                topK: candidateLimit
              })
            )
          )
        ).flat()
      );
      this.throwIfAborted(signal);
    }

    return this.deduplicateCandidates(sources).slice(0, candidateLimit);
  }

  /**
   * 加权 RRF 只依赖排名，因此不会把余弦相似度与词法分数直接相加。
   * 对外 score 再结合通道置信度校准到 0-1，保持历史阈值和 UI 百分比语义稳定。
   */
  private fuseCandidates(
    vectorCandidates: RetrievalCandidate[],
    keywordCandidates: RetrievalCandidate[]
  ): RetrievalSource[] {
    const vectors = this.deduplicateCandidates(vectorCandidates);
    const keywords = this.deduplicateCandidates(keywordCandidates);
    const fused = new Map<
      string,
      {
        source: RetrievalCandidate;
        vectorScore?: number;
        keywordScore?: number;
        rrfScore: number;
      }
    >();

    const addChannel = (
      candidates: RetrievalCandidate[],
      channel: "vector" | "keyword",
      weight: number
    ) => {
      candidates.forEach((candidate, index) => {
        const current = fused.get(candidate.chunkId) ?? { source: candidate, rrfScore: 0 };
        current.rrfScore += weight / (RRF_K + index + 1);
        if (channel === "vector") current.vectorScore = this.clampScore(candidate.score);
        else current.keywordScore = this.clampScore(candidate.score);
        fused.set(candidate.chunkId, current);
      });
    };

    addChannel(vectors, "vector", VECTOR_WEIGHT);
    addChannel(keywords, "keyword", KEYWORD_WEIGHT);

    const activeMaxRrf =
      (vectors.length > 0 ? VECTOR_WEIGHT / (RRF_K + 1) : 0) +
      (keywords.length > 0 ? KEYWORD_WEIGHT / (RRF_K + 1) : 0);

    return [...fused.values()]
      .map(({ source, vectorScore, keywordScore, rrfScore }) => {
        const fusionScore = activeMaxRrf > 0 ? this.clampScore(rrfScore / activeMaxRrf) : 0;
        const confidence = Math.max(vectorScore ?? 0, keywordScore ?? 0);

        return {
          ...source,
          score: this.clampScore(confidence * CONFIDENCE_WEIGHT + fusionScore * FUSION_WEIGHT),
          ...(vectorScore !== undefined ? { vectorScore } : {}),
          ...(keywordScore !== undefined ? { keywordScore } : {}),
          fusionScore,
          matchedBy: [
            ...(vectorScore !== undefined ? (["vector"] as const) : []),
            ...(keywordScore !== undefined ? (["keyword"] as const) : [])
          ]
        } satisfies RetrievalSource;
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          (right.fusionScore ?? 0) - (left.fusionScore ?? 0) ||
          left.chunkId.localeCompare(right.chunkId)
      );
  }

  /** 单通道内部按 chunk 去重，并保留最高置信度结果，保证排名稳定。 */
  private deduplicateCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
    const byChunkId = new Map<string, RetrievalCandidate>();

    for (const candidate of candidates) {
      const existing = byChunkId.get(candidate.chunkId);
      if (!existing || candidate.score > existing.score) byChunkId.set(candidate.chunkId, candidate);
    }

    return [...byChunkId.values()].sort(
      (left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId)
    );
  }

  private groupRetrievalConfigs(configs: RetrievalConfig[]): RetrievalConfigGroup[] {
    const groups = new Map<string, RetrievalConfigGroup>();
    const expectedWorkspaceId = configs[0]?.workspaceId;

    for (const config of configs) {
      if (!config.workspaceId || config.workspaceId !== expectedWorkspaceId) {
        throw new RetrievalConfigurationError("禁止跨项目空间合并知识库检索");
      }

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
        throw new RetrievalConfigurationError(
          `Embedding 向量维度不匹配：同一个 Embedding 模型绑定了 ${existing.embeddingDimension} 维和 ${config.embeddingDimension} 维知识库，请重建配置异常的知识库。`
        );
      }

      existing.knowledgeBases.push(knowledgeBase);
    }

    return [...groups.values()];
  }

  private normalizeTopK(value: number): number {
    if (!Number.isInteger(value) || value <= 0) return DEFAULT_TOP_K;
    return Math.min(value, MAX_TOP_K);
  }

  /** scoreThreshold 由 Workflow Executor 校验；其他调用方传入异常值时忽略。 */
  private normalizeScoreThreshold(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : undefined;
  }

  private clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  /** Prisma 查询暂不能主动取消，但每个外部阶段前后检查 Signal，阻止继续发起后续检索。 */
  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    const error = new Error("retrieval canceled");
    error.name = "AbortError";
    throw error;
  }
}
