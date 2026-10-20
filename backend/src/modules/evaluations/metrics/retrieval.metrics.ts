import type { RetrievalSource } from "../../retrieval/dto/retrieval.dto";

export type RetrievalRuleMetrics = {
  hitRateAt5: number | null;
  recallAt5: number | null;
  mrr: number | null;
  emptyRetrieval: boolean;
  relevantExpectedCount: number;
};

/** 只使用稳定 ID 计算规则指标；没有期望标注时返回 null，不能伪装成 0 分。 */
export function calculateRetrievalMetrics(
  sources: RetrievalSource[],
  expectedDocumentIds: string[],
  expectedChunkIds: string[]
): RetrievalRuleMetrics {
  const expected = new Set([
    ...expectedDocumentIds.map((id) => `document:${id}`),
    ...expectedChunkIds.map((id) => `chunk:${id}`)
  ]);
  if (expected.size === 0) {
    return {
      hitRateAt5: null,
      recallAt5: null,
      mrr: null,
      emptyRetrieval: sources.length === 0,
      relevantExpectedCount: 0
    };
  }
  const topFive = sources.slice(0, 5);
  const matchedExpected = new Set<string>();
  let firstRelevantRank: number | null = null;
  topFive.forEach((source, index) => {
    const keys = [`document:${source.documentId}`, `chunk:${source.chunkId}`];
    const matches = keys.filter((key) => expected.has(key));
    matches.forEach((key) => matchedExpected.add(key));
    if (matches.length && firstRelevantRank === null) firstRelevantRank = index + 1;
  });
  return {
    hitRateAt5: firstRelevantRank === null ? 0 : 1,
    recallAt5: matchedExpected.size / expected.size,
    mrr: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
    emptyRetrieval: sources.length === 0,
    relevantExpectedCount: expected.size
  };
}

