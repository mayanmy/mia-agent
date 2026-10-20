import * as assert from "node:assert/strict";

import { calculateRetrievalMetrics } from "./retrieval.metrics";

const source = (documentId: string, chunkId: string) => ({
  knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
  documentId,
  documentName: "制度",
  chunkId,
  chunkIndex: 0,
  content: "内容",
  score: 0.9
});

export const tests = [
  {
    name: "Evaluation retrieval metrics calculate hit recall and reciprocal rank",
    run: () => {
      const metrics = calculateRetrievalMetrics(
        [source("doc-other", "chunk-other"), source("doc-hit", "chunk-hit")],
        ["doc-hit"],
        []
      );
      assert.equal(metrics.hitRateAt5, 1);
      assert.equal(metrics.recallAt5, 1);
      assert.equal(metrics.mrr, 0.5);
    }
  },
  {
    name: "Evaluation retrieval metrics keep unlabelled metrics null",
    run: () => {
      const metrics = calculateRetrievalMetrics([], [], []);
      assert.equal(metrics.hitRateAt5, null);
      assert.equal(metrics.recallAt5, null);
      assert.equal(metrics.mrr, null);
      assert.equal(metrics.emptyRetrieval, true);
    }
  }
];

