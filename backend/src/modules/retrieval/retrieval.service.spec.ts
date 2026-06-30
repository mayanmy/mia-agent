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
    name: "RetrievalService searches knowledge bases grouped by embedding model",
    run: async () => {
      const searchedKnowledgeBaseIds: string[][] = [];
      const searchedModelIds: string[] = [];
      const prisma = {
        $queryRawUnsafe: async (
          _sql: string,
          _embedding: string,
          ids: string[],
          modelConfigId: string
        ) => {
          searchedKnowledgeBaseIds.push(ids);
          searchedModelIds.push(modelConfigId);
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
          { id: "kb-a", embeddingModelConfigId: "embedding-a", embeddingDimension: 1536 },
          { id: "kb-b", embeddingModelConfigId: "embedding-b", embeddingDimension: 1024 }
        ]
      };
      const modelProvidersService = {
        createEmbedding: async ({ modelConfigId }: { modelConfigId: string }) => {
          const dimension = modelConfigId === "embedding-a" ? 1536 : 1024;

          return {
            embeddings: [Array.from({ length: dimension }, () => 0.1)],
            model: "embedding",
            providerId: "provider-id",
            providerType: "OPENAI_COMPATIBLE"
          };
        }
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

      assert.deepEqual(searchedKnowledgeBaseIds, [["kb-a"], ["kb-b"]]);
      assert.deepEqual(searchedModelIds, ["embedding-a", "embedding-b"]);
      assert.equal(result.sources.length, 2);
      assert.equal(result.sources[0].content, "chunk content");
    }
  },
  {
    name: "RetrievalService reports readable error when embedding dimension mismatches",
    run: async () => {
      const prisma = {
        $queryRawUnsafe: async () => {
          throw new Error("pgvector query should not be called");
        }
      };
      const knowledgeService = {
        getRetrievalConfigs: async () => [
          { id: "kb-a", embeddingModelConfigId: "embedding-a", embeddingDimension: 1536 }
        ]
      };
      const modelProvidersService = {
        createEmbedding: async () => ({
          embeddings: [Array.from({ length: 1024 }, () => 0.1)],
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

      await assert.rejects(
        () =>
          service.retrieveKnowledgeContext({
            query: "hello",
            knowledgeBaseIds: ["kb-a"]
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Embedding 向量维度不匹配/u);
          assert.match(error.message, /1536/u);
          assert.match(error.message, /1024/u);
          return true;
        }
      );
    }
  }
];
