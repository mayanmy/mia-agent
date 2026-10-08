import { Inject, Injectable } from "@nestjs/common";

import { KnowledgeService } from "../knowledge/knowledge.service";
import { VECTOR_STORE, VectorIndexNamespace, VectorStore } from "../knowledge/vector-store";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import {
  RetrievalContext,
  RetrievalSource,
  RetrieveKnowledgeContextRequest
} from "./dto/retrieval.dto";

/** 未指定返回数量时，默认只向 Prompt 注入 5 个切片，控制上下文长度和噪声。 */
const DEFAULT_TOP_K = 5;
/** 防止调用方一次注入过多切片，挤占模型上下文并放大数据库查询成本。 */
const MAX_TOP_K = 12;
/** 每个召回通道至少保留 20 个候选，为后续融合留下足够的交集与排序空间。 */
const MIN_CHANNEL_CANDIDATES = 20;
/** 候选池硬上限，避免 topK 异常放大 Embedding、SQL 和内存开销。 */
const MAX_CHANNEL_CANDIDATES = 60;
/** 候选数通常取最终 topK 的 4 倍，先宽召回、再融合截断。 */
const CANDIDATE_MULTIPLIER = 4;
/** RRF 常用平滑常数；减弱头部名次差距，避免第一名对融合结果形成绝对支配。 */
const RRF_K = 60;
/** 语义召回更适合自然语言问答，因此权重高于关键词通道。 */
const VECTOR_WEIGHT = 0.65;
/** 关键词通道主要补充错误码、路径、版本号和专有名词等精确匹配。 */
const KEYWORD_WEIGHT = 0.35;
/** 最终分数以召回通道自身置信度为主，保持 scoreThreshold 的直观语义。 */
const CONFIDENCE_WEIGHT = 0.75;
/** 排名融合分用于奖励双通道共同命中，以及各通道中的稳定高排名。 */
const FUSION_WEIGHT = 0.25;

/** 融合前的内部候选没有 matchedBy；该字段必须根据实际通道统一生成。 */
type RetrievalCandidate = Omit<RetrievalSource, "matchedBy">;

/** Knowledge 模块返回的单个知识库检索配置快照。 */
type RetrievalConfig = {
  /** 知识库 ID，同时用于数据库过滤和来源追踪。 */
  id: string;
  /** 知识库所属空间；同一次检索中的所有知识库必须一致。 */
  workspaceId: string;
  /** 生成文档向量时使用的模型配置，查询向量必须使用相同模型。 */
  embeddingModelConfigId: string;
  /** 已持久化向量维度，用于在查询前阻断错误模型配置。 */
  embeddingDimension: number;
  /** 当前只支持 pgvector，但仍保留类型边界供向量存储抽象使用。 */
  vectorStoreType: "PGVECTOR";
  /** 逻辑向量集合名称，避免不同知识库索引互相污染。 */
  vectorCollectionName: string;
};

/** 可共享同一次查询 Embedding 的知识库分组。 */
type RetrievalConfigGroup = {
  workspaceId: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
  /** 每个知识库仍携带独立 namespace，向量查询不能跨集合误命中。 */
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
    // elapsedMs 覆盖配置读取、Embedding、双路召回、融合和过滤的完整调用耗时。
    const startedAt = Date.now();
    // 空白不会提供检索信息，统一裁掉首尾空格后再参与缓存键、Embedding 和关键词查询。
    const normalizedQuery = query.trim();

    // 没有有效问题或 Agent 未绑定知识库时直接返回，避免无意义调用外部 Embedding。
    if (!normalizedQuery || knowledgeBaseIds.length === 0) {
      return { query: normalizedQuery, sources: [], elapsedMs: Date.now() - startedAt };
    }

    // KnowledgeService 会过滤已禁用、已删除或当前空间不可访问的知识库。
    const retrievalConfigs = await this.knowledgeService.getRetrievalConfigs(knowledgeBaseIds);

    // Agent 绑定存在但当前没有可用索引配置时，按“无知识命中”处理而不是制造模型错误。
    if (retrievalConfigs.length === 0) {
      return { query: normalizedQuery, sources: [], elapsedMs: Date.now() - startedAt };
    }

    // 不同 Embedding 模型生成的向量不在同一向量空间，必须分组分别生成查询向量。
    const groups = this.groupRetrievalConfigs(retrievalConfigs);
    const workspaceId = groups[0]?.workspaceId;
    if (!workspaceId) throw new RetrievalConfigurationError("知识库缺少项目空间配置");

    const normalizedTopK = this.normalizeTopK(topK);
    // 最终只返回 topK，但两路召回必须取更宽的候选池，否则 RRF 很难发现交叉命中。
    const candidateLimit = Math.min(
      Math.max(normalizedTopK * CANDIDATE_MULTIPLIER, MIN_CHANNEL_CANDIDATES),
      MAX_CHANNEL_CANDIDATES
    );
    // 在启动任何昂贵的远程或数据库调用前，优先响应上游取消。
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
    // Promise.allSettled 不会因单路失败而抛出，因此并行结束后再次检查用户是否已取消。
    this.throwIfAborted(signal);

    // 模型维度、跨空间等配置错误属于确定性故障，不能伪装成关键词降级成功。
    if (
      vectorResult.status === "rejected" &&
      vectorResult.reason instanceof RetrievalConfigurationError
    ) {
      throw vectorResult.reason;
    }

    // 网络或数据库瞬时故障允许单通道降级；两路都失败时已没有可信结果可返回。
    if (vectorResult.status === "rejected" && keywordResult.status === "rejected") {
      throw new AggregateError(
        [vectorResult.reason, keywordResult.reason],
        "向量检索和关键词检索均失败"
      );
    }

    const vectorCandidates = vectorResult.status === "fulfilled" ? vectorResult.value : [];
    const keywordCandidates = keywordResult.status === "fulfilled" ? keywordResult.value : [];
    // diagnostics 只记录通道状态和数量，不保存查询正文或切片内容，便于安全地进入 Run Trace。
    const degradedChannels: Array<"vector" | "keyword"> = [];
    if (vectorResult.status === "rejected") degradedChannels.push("vector");
    if (keywordResult.status === "rejected") degradedChannels.push("keyword");

    const fusedSources = this.fuseCandidates(vectorCandidates, keywordCandidates);
    const normalizedScoreThreshold = this.normalizeScoreThreshold(scoreThreshold);

    return {
      query: normalizedQuery,
      // 阈值必须作用于融合后的统一 0-1 分数，再截取 topK；提前过滤会破坏 RRF 排名。
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
    // 多个模型分组的结果先汇总，末尾再按 chunkId 全局去重。
    const sources: RetrievalCandidate[] = [];

    // 分组间顺序执行，避免一次请求并发占用多个 Embedding Provider 槽位；组内知识库查询并行。
    for (const group of groups) {
      this.throwIfAborted(signal);
      // 同一模型组只生成一次查询向量，组内所有知识库复用，减少远程调用和计费。
      const queryEmbedding = await this.modelProvidersService.createEmbedding({
        modelConfigId: group.embeddingModelConfigId,
        input: query,
        signal
      });
      this.throwIfAborted(signal);
      // 当前接口一次只提交一个 query，因此只读取 embeddings[0]。
      const embedding = queryEmbedding.embeddings[0];

      // Provider 返回空数组时该组无候选；其他模型组仍可继续提供结果。
      if (!embedding) continue;
      // pgvector 列维度固定，提前给出可操作错误比让数据库抛低层异常更容易排查。
      if (embedding.length !== group.embeddingDimension) {
        throw new RetrievalConfigurationError(
          `Embedding 向量维度不匹配：当前知识库需要 ${group.embeddingDimension} 维，但模型返回 ${embedding.length} 维。请检查知识库的 Embedding 模型配置。`
        );
      }

      // 每个知识库携带独立 namespace；并行查询只共享查询向量，不合并索引边界。
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

    // 不同集合理论上不应复用 chunkId，但仍在边界层去重，抵御迁移或脏数据造成的重复。
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
    // 先消除单通道重复项，确保 rank index 真正代表唯一 chunk 的名次。
    const vectors = this.deduplicateCandidates(vectorCandidates);
    const keywords = this.deduplicateCandidates(keywordCandidates);
    // Map 以 chunkId 为融合主键；双路命中时保留一个来源对象并累计两个通道的信息。
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
        // index 从 0 开始，因此真实排名为 index + 1。
        current.rrfScore += weight / (RRF_K + index + 1);
        // 原始通道分数先夹到 0-1，防止异常 Provider/SQL 分数污染最终排序。
        if (channel === "vector") current.vectorScore = this.clampScore(candidate.score);
        else current.keywordScore = this.clampScore(candidate.score);
        fused.set(candidate.chunkId, current);
      });
    };

    addChannel(vectors, "vector", VECTOR_WEIGHT);
    addChannel(keywords, "keyword", KEYWORD_WEIGHT);

    // 根据本次实际可用通道计算理论最高 RRF；单路降级时仍能归一化到 0-1。
    const activeMaxRrf =
      (vectors.length > 0 ? VECTOR_WEIGHT / (RRF_K + 1) : 0) +
      (keywords.length > 0 ? KEYWORD_WEIGHT / (RRF_K + 1) : 0);

    // chunkId 作为最终稳定兜底，确保相同输入在同分情况下不会随机抖动。
    return [...fused.values()]
      .map(({ source, vectorScore, keywordScore, rrfScore }) => {
        // fusionScore 表达排名质量；confidence 表达至少一个通道对内容相关性的直接判断。
        const fusionScore = activeMaxRrf > 0 ? this.clampScore(rrfScore / activeMaxRrf) : 0;
        const confidence = Math.max(vectorScore ?? 0, keywordScore ?? 0);

        return {
          ...source,
          // 置信度占主导，RRF 用于校正排序；两部分权重之和必须保持为 1。
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
      // 相同 chunk 多次出现时保留最高通道置信度，避免低分副本覆盖高分命中。
      if (!existing || candidate.score > existing.score) byChunkId.set(candidate.chunkId, candidate);
    }

    return [...byChunkId.values()].sort(
      (left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId)
    );
  }

  private groupRetrievalConfigs(configs: RetrievalConfig[]): RetrievalConfigGroup[] {
    const groups = new Map<string, RetrievalConfigGroup>();
    // 第一条配置建立可信空间基准；后续任何不同空间都视为越权或脏配置。
    const expectedWorkspaceId = configs[0]?.workspaceId;

    for (const config of configs) {
      if (!config.workspaceId || config.workspaceId !== expectedWorkspaceId) {
        throw new RetrievalConfigurationError("禁止跨项目空间合并知识库检索");
      }

      // 模型配置 ID 是向量空间的第一分组键，namespace 则继续隔离具体知识库索引。
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

      // 即使模型配置 ID 相同，历史错误配置也可能留下不同维度；禁止把它们放入同组查询。
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
    // 非正整数统一回退默认值；合法值再应用服务端硬上限。
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
    // NaN/Infinity 不能参与稳定排序，统一视为无置信度。
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
