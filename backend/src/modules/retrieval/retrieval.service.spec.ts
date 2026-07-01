import * as assert from "node:assert/strict";

import { RetrievalService } from "./retrieval.service";

export const tests = [
  {
    name: "RetrievalService returns empty context without knowledge bases",
    run: async () => {
      const knowledgeService = {
        getRetrievalConfigs: async () => {
          throw new Error("knowledge service should not be called");
        }
      };
      const modelProvidersService = {};
      const vectorStore = {};
      const service = new RetrievalService(
        knowledgeService as never,
        modelProvidersService as never,
        vectorStore as never
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
      const searchedNamespaces: string[] = [];
      const searchedModelIds: string[] = [];
      const vectorStore = {
        search: async ({
          namespace,
          knowledgeBaseIds,
          embeddingModelConfigId
        }: {
          namespace: { name: string };
          knowledgeBaseIds: string[];
          embeddingModelConfigId: string;
        }) => {
          searchedNamespaces.push(namespace.name);
          searchedModelIds.push(embeddingModelConfigId);
          return [
            {
              knowledgeBaseId: knowledgeBaseIds[0],
              documentId: "document-id",
              documentName: "manual.md",
              chunkId: "chunk-id",
              chunkIndex: 0,
              content: "chunk content",
              score: 0.8
            }
          ];
        }
      };
      const knowledgeService = {
        getRetrievalConfigs: async () => [
          {
            id: "kb-a",
            embeddingModelConfigId: "embedding-a",
            embeddingDimension: 1536,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-a"
          },
          {
            id: "kb-b",
            embeddingModelConfigId: "embedding-b",
            embeddingDimension: 1024,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-b"
          }
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
        knowledgeService as never,
        modelProvidersService as never,
        vectorStore as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "hello",
        knowledgeBaseIds: ["kb-a", "kb-b"]
      });

      assert.deepEqual(searchedNamespaces, ["kb-kb-a", "kb-kb-b"]);
      assert.deepEqual(searchedModelIds, ["embedding-a", "embedding-b"]);
      assert.equal(result.sources.length, 2);
      assert.equal(result.sources[0].content, "chunk content");
    }
  },
  {
    name: "RetrievalService reports readable error when embedding dimension mismatches",
    run: async () => {
      const vectorStore = {
        search: async () => {
          throw new Error("vector store should not be called");
        }
      };
      const knowledgeService = {
        getRetrievalConfigs: async () => [
          {
            id: "kb-a",
            embeddingModelConfigId: "embedding-a",
            embeddingDimension: 1536,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-a"
          }
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
        knowledgeService as never,
        modelProvidersService as never,
        vectorStore as never
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
