/** Nest Provider 注入令牌，使 Knowledge 模块不依赖具体向量库实现。 */
export const VECTOR_STORE = Symbol("VECTOR_STORE");

/** 当前支持的向量存储实现类型。 */
export type VectorStoreType = "PGVECTOR";

/** 向量索引的实现类型和逻辑隔离名称。 */
export type VectorIndexNamespace = {
  type: VectorStoreType;
  name: string;
};

/** 写入单个切片向量所需的完整维度与模型约束。 */
export type VectorStoreUpsertEmbeddingInput = {
  workspaceId: string;
  namespace: VectorIndexNamespace;
  knowledgeBaseId: string;
  chunkId: string;
  embeddingModelConfigId: string;
  /** 写入前必须与向量长度和知识库配置一致。 */
  embeddingDimension: number;
  embedding: number[];
};

/** 跨一个或多个已授权知识库执行向量检索的输入。 */
export type VectorStoreSearchInput = {
  workspaceId: string;
  namespace: VectorIndexNamespace;
  embedding: number[];
  embeddingDimension: number;
  /** 限定使用同一 Embedding 模型生成的向量，禁止混用向量空间。 */
  embeddingModelConfigId: string;
  knowledgeBaseIds: string[];
  topK: number;
};

/** 向量存储返回的命中切片与引用来源。 */
export type VectorStoreSearchResult = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
};

/** 向量存储抽象；调用方不得直接拼接具体存储的 SQL 或过滤语法。 */
export interface VectorStore {
  upsertEmbedding(input: VectorStoreUpsertEmbeddingInput): Promise<void>;

  deleteDocument(input: {
    namespace: VectorIndexNamespace | null;
    documentId: string;
  }): Promise<void>;

  search(input: VectorStoreSearchInput): Promise<VectorStoreSearchResult[]>;
}
