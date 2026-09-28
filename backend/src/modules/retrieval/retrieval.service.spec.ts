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
              chunkId: `${knowledgeBaseIds[0]}-chunk-id`,
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
            workspaceId: "workspace-a",
            embeddingModelConfigId: "embedding-a",
            embeddingDimension: 1536,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-a"
          },
          {
            id: "kb-b",
            workspaceId: "workspace-a",
            embeddingModelConfigId: "embedding-b",
            embeddingDimension: 1024,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-b"
          }
        ],
        searchKeywordChunks: async () => []
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
            workspaceId: "workspace-a",
            embeddingModelConfigId: "embedding-a",
            embeddingDimension: 1536,
            vectorStoreType: "PGVECTOR",
            vectorCollectionName: "kb-kb-a"
          }
        ],
        searchKeywordChunks: async () => [
          {
            knowledgeBaseId: "kb-a",
            documentId: "document-id",
            documentName: "manual.md",
            chunkId: "keyword-result",
            chunkIndex: 0,
            content: "keyword fallback",
            score: 1
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
  },
  {
    name: "RetrievalService forwards cancellation and applies score threshold after merging",
    run: async () => {
      const signal = new AbortController().signal;
      let embeddingSignal: AbortSignal | undefined;
      const service = new RetrievalService(
        {
          getRetrievalConfigs: async () => [
            {
              id: "kb-a",
              workspaceId: "workspace-a",
              embeddingModelConfigId: "embedding-a",
              embeddingDimension: 2,
              vectorStoreType: "PGVECTOR",
              vectorCollectionName: "kb-a"
            }
          ],
          searchKeywordChunks: async () => []
        } as never,
        {
          createEmbedding: async ({ signal: requestSignal }: { signal?: AbortSignal }) => {
            embeddingSignal = requestSignal;
            return { embeddings: [[0.1, 0.2]] };
          }
        } as never,
        {
          search: async () => [
            {
              knowledgeBaseId: "kb-a",
              documentId: "document-id",
              documentName: "manual.md",
              chunkId: "high",
              chunkIndex: 0,
              content: "high",
              score: 0.9
            },
            {
              knowledgeBaseId: "kb-a",
              documentId: "document-id",
              documentName: "manual.md",
              chunkId: "low",
              chunkIndex: 1,
              content: "low",
              score: 0.4
            }
          ]
        } as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "hello",
        knowledgeBaseIds: ["kb-a"],
        scoreThreshold: 0.7,
        signal
      });

      assert.equal(embeddingSignal, signal);
      assert.deepEqual(
        result.sources.map((source) => source.content),
        ["high"]
      );

      const resultWithInvalidThreshold = await service.retrieveKnowledgeContext({
        query: "hello",
        knowledgeBaseIds: ["kb-a"],
        scoreThreshold: 2
      });
      assert.deepEqual(
        resultWithInvalidThreshold.sources.map((source) => source.content),
        ["high", "low"]
      );
    }
  },
  {
    name: "RetrievalService boosts chunks matched by both vector and keyword channels",
    run: async () => {
      const source = (chunkId: string, content: string, score: number) => ({
        knowledgeBaseId: "kb-a",
        documentId: "document-id",
        documentName: "manual.md",
        chunkId,
        chunkIndex: 0,
        content,
        score
      });
      const service = new RetrievalService(
        {
          getRetrievalConfigs: async () => [
            {
              id: "kb-a",
              workspaceId: "workspace-a",
              embeddingModelConfigId: "embedding-a",
              embeddingDimension: 2,
              vectorStoreType: "PGVECTOR",
              vectorCollectionName: "kb-a"
            }
          ],
          searchKeywordChunks: async () => [
            source("shared", "shared result", 0.9),
            source("keyword-only", "ERR_DEPLOY_042", 0.95)
          ]
        } as never,
        { createEmbedding: async () => ({ embeddings: [[0.1, 0.2]] }) } as never,
        {
          search: async () => [
            source("shared", "shared result", 0.8),
            source("vector-only", "semantic result", 0.85)
          ]
        } as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "ERR_DEPLOY_042 是什么",
        knowledgeBaseIds: ["kb-a"]
      });

      assert.equal(result.sources[0].chunkId, "shared");
      assert.deepEqual(result.sources[0].matchedBy, ["vector", "keyword"]);
      assert.equal(result.sources.filter((item) => item.chunkId === "shared").length, 1);
      assert.deepEqual(result.diagnostics, {
        strategy: "hybrid_rrf",
        vectorCandidateCount: 2,
        keywordCandidateCount: 2,
        fusedCandidateCount: 3,
        degradedChannels: []
      });
    }
  },
  {
    name: "RetrievalService degrades to keyword retrieval when embedding provider fails",
    run: async () => {
      const service = new RetrievalService(
        {
          getRetrievalConfigs: async () => [
            {
              id: "kb-a",
              workspaceId: "workspace-a",
              embeddingModelConfigId: "embedding-a",
              embeddingDimension: 2,
              vectorStoreType: "PGVECTOR",
              vectorCollectionName: "kb-a"
            }
          ],
          searchKeywordChunks: async () => [
            {
              knowledgeBaseId: "kb-a",
              documentId: "document-id",
              documentName: "manual.md",
              chunkId: "keyword-only",
              chunkIndex: 0,
              content: "exact keyword result",
              score: 1
            }
          ]
        } as never,
        {
          createEmbedding: async () => {
            throw new Error("provider unavailable");
          }
        } as never,
        {} as never
      );

      const result = await service.retrieveKnowledgeContext({
        query: "exact keyword",
        knowledgeBaseIds: ["kb-a"]
      });

      assert.equal(result.sources[0].chunkId, "keyword-only");
      assert.deepEqual(result.sources[0].matchedBy, ["keyword"]);
      assert.deepEqual(result.diagnostics?.degradedChannels, ["vector"]);
    }
  },
  {
    name: "RetrievalService fails when vector and keyword channels both fail",
    run: async () => {
      const service = new RetrievalService(
        {
          getRetrievalConfigs: async () => [
            {
              id: "kb-a",
              workspaceId: "workspace-a",
              embeddingModelConfigId: "embedding-a",
              embeddingDimension: 2,
              vectorStoreType: "PGVECTOR",
              vectorCollectionName: "kb-a"
            }
          ],
          searchKeywordChunks: async () => {
            throw new Error("database timeout");
          }
        } as never,
        {
          createEmbedding: async () => {
            throw new Error("provider unavailable");
          }
        } as never,
        {} as never
      );

      await assert.rejects(
        () =>
          service.retrieveKnowledgeContext({
            query: "hello",
            knowledgeBaseIds: ["kb-a"]
          }),
        /向量检索和关键词检索均失败/u
      );
    }
  }
];
