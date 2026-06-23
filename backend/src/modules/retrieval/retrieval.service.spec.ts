import * as assert from "node:assert/strict";

import { RetrievalService } from "./retrieval.service";

export const tests = [
  {
    name: "RetrievalService returns empty context without knowledge bases",
    run: async () => {
      const prisma = {};
      const knowledgeService = {
        getRetrievalConfigs: async () => {
          throw new Error("knowledge service should not be called");
        }
      };
      const modelProvidersService = {};
      const service = new RetrievalService(
        prisma as never,
        knowledgeService as never,
        modelProvidersService as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "hello",
        knowledgeBaseIds: []
      });

      assert.equal(result.query, "hello");
      assert.deepEqual(result.sources, []);
    }
  },
  {
    name: "RetrievalService searches only knowledge bases with the same embedding model",
    run: async () => {
      const searchedKnowledgeBaseIds: string[][] = [];
      const prisma = {
        $queryRawUnsafe: async (_sql: string, _embedding: string, ids: string[]) => {
          searchedKnowledgeBaseIds.push(ids);
          return [
            {
              knowledge_base_id: ids[0],
              document_id: "document-id",
              document_name: "manual.md",
              chunk_id: "chunk-id",
              chunk_index: 0,
              content: "chunk content",
              score: 0.8
            }
          ];
        }
      };
      const knowledgeService = {
        getRetrievalConfigs: async () => [
          { id: "kb-a", embeddingModelConfigId: "embedding-a" },
          { id: "kb-b", embeddingModelConfigId: "embedding-b" }
        ]
      };
      const modelProvidersService = {
        createEmbedding: async () => ({
          embeddings: [[0.1, 0.2, 0.3]],
          model: "embedding",
          providerId: "provider-id",
          providerType: "OPENAI_COMPATIBLE"
        })
      };
      const service = new RetrievalService(
        prisma as never,
        knowledgeService as never,
        modelProvidersService as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "hello",
        knowledgeBaseIds: ["kb-a", "kb-b"]
      });

      assert.deepEqual(searchedKnowledgeBaseIds, [["kb-a"]]);
      assert.equal(result.sources.length, 1);
      assert.equal(result.sources[0].content, "chunk content");
    }
  }
];
