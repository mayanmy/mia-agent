/** 单个命中切片及其可追溯来源。 */
export type RetrievalSource = {
  /** 来源知识库 ID。 */
  knowledgeBaseId: string;
  /** 来源文档 ID。 */
  documentId: string;
  /** 面向引用展示的原始文档名。 */
  documentName: string;
  /** 命中的切片 ID。 */
  chunkId: string;
  /** 切片在文档中的稳定顺序。 */
  chunkIndex: number;
  /** 进入 RAG 上下文的切片正文。 */
  content: string;
  /** 向量相似度分数，越高表示越相关。 */
  score: number;
};

/** Retrieval 模块返回给 Chat/Workflow 的完整可序列化上下文。 */
export type RetrievalContext = {
  /** 实际用于生成查询向量的文本。 */
  query: string;
  /** 已按相关度和阈值过滤的来源。 */
  sources: RetrievalSource[];
  /** 包含 Embedding 与向量查询的总耗时毫秒数。 */
  elapsedMs: number;
};

/** 跨模块发起知识检索所需的稳定参数。 */
export type RetrieveKnowledgeContextRequest = {
  /** 用户查询或经过改写的检索文本。 */
  query: string;
  /** Agent 已授权绑定的知识库 ID 集合。 */
  knowledgeBaseIds: string[];
  /** 每个检索请求最多返回的切片数。 */
  topK?: number;
  /** 丢弃低相关度切片的最低分数。 */
  scoreThreshold?: number;
  /** 用户取消或上游超时时终止 Embedding 和向量查询。 */
  signal?: AbortSignal;
};
