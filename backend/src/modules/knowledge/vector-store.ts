export const VECTOR_STORE = Symbol("VECTOR_STORE");

export type VectorStoreType = "PGVECTOR";

export type VectorIndexNamespace = {
  type: VectorStoreType;
  name: string;
};

export type VectorStoreUpsertEmbeddingInput = {
  namespace: VectorIndexNamespace;
  knowledgeBaseId: string;
  chunkId: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
  embedding: number[];
};

export type VectorStoreSearchInput = {
  namespace: VectorIndexNamespace;
  embedding: number[];
  embeddingDimension: number;
  embeddingModelConfigId: string;
  knowledgeBaseIds: string[];
  topK: number;
};

export type VectorStoreSearchResult = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
};

export interface VectorStore {
  upsertEmbedding(input: VectorStoreUpsertEmbeddingInput): Promise<void>;

  deleteDocument(input: {
    namespace: VectorIndexNamespace | null;
    documentId: string;
  }): Promise<void>;

  search(input: VectorStoreSearchInput): Promise<VectorStoreSearchResult[]>;
}

