/** 创建知识库的输入；Embedding 配置创建后不可隐式漂移。 */
export type KnowledgeBaseCreateDto = {
  /** 知识库展示名称。 */
  name?: string;
  /** 知识库用途说明。 */
  description?: string;
  /** 绑定的 Embedding 类型模型配置 ID。 */
  embeddingModelConfigId?: string;
  /** 是否允许 Agent 检索该知识库。 */
  enabled?: boolean;
};

/** 更新知识库元数据的输入；缺失字段保持原值。 */
export type KnowledgeBaseUpdateDto = Partial<KnowledgeBaseCreateDto>;

/** 知识库列表分页与启用状态筛选。 */
export type KnowledgeBaseQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
  /** 可选启用状态，由 Service 严格解析。 */
  enabled?: string;
};

/** 知识库文档列表的分页与索引状态筛选。 */
export type KnowledgeDocumentQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
  /** 文档生命周期状态筛选。 */
  status?: string;
};

/** 文档从上传、解析、向量化到软删除的完整生命周期状态。 */
export type KnowledgeDocumentStatus =
  | "uploaded"
  | "pending"
  | "processing"
  | "parsing"
  | "chunking"
  | "embedding"
  | "indexed"
  | "failed"
  | "deleted";

/** 知识库管理列表展示和容量排障所需的摘要。 */
export type KnowledgeBaseListItem = {
  /** 知识库 ID。 */
  id: string;
  /** 知识库展示名称。 */
  name: string;
  /** 知识库用途说明。 */
  description: string;
  /** 固定使用的 Embedding 模型配置 ID。 */
  embeddingModelConfigId: string;
  /** 向量维度，写入前必须与集合和模型一致。 */
  embeddingDimension: number;
  /** 当前仅支持 PostgreSQL pgvector。 */
  vectorStoreType: "PGVECTOR";
  /** 向量存储中的逻辑集合名称。 */
  vectorCollectionName: string;
  /** Embedding 模型展示名称。 */
  embeddingModelName: string;
  /** Embedding 供应商展示名称。 */
  embeddingProviderName: string;
  /** 未删除文档数量。 */
  documentCount: number;
  /** 已生成切片数量。 */
  chunkCount: number;
  /** 当前索引失败的文档数量。 */
  failedDocumentCount: number;
  /** 是否允许用于新检索。 */
  enabled: boolean;
  /** 知识库创建时间。 */
  createdAt: Date;
  /** 知识库最近更新时间。 */
  updatedAt: Date;
};

/** 当前详情与列表字段一致，保留别名以稳定 API 语义。 */
export type KnowledgeBaseDetail = KnowledgeBaseListItem;

/** 文档抽屉展示的生命周期与索引摘要。 */
export type KnowledgeDocumentListItem = {
  /** 文档 ID。 */
  id: string;
  /** 所属知识库 ID。 */
  knowledgeBaseId: string;
  /** 存储层使用的安全文件名。 */
  filename: string;
  /** 用户上传时的原始文件名。 */
  originalFilename: string;
  /** 上传文件 MIME 类型。 */
  mimeType: string;
  /** 十进制字符串形式的字节数，避免大文件整数精度问题。 */
  fileSize: string;
  /** 当前解析和索引生命周期状态。 */
  status: KnowledgeDocumentStatus;
  /** 失败状态下的管理员排障信息。 */
  errorMessage: string | null;
  /** 当前文档已保存的切片数量。 */
  chunkCount: number;
  /** 最近一次完整索引成功时间。 */
  indexedAt: Date | null;
  /** 文档记录创建时间。 */
  createdAt: Date;
  /** 文档记录最近更新时间。 */
  updatedAt: Date;
};

/** Retrieval 模块读取的知识库最小运行配置，不暴露 Knowledge ORM 实体。 */
export type KnowledgeBaseRetrievalConfig = {
  /** 所属项目空间，用于向量查询的最后一道数据库过滤。 */
  workspaceId: string;
  /** 知识库 ID。 */
  id: string;
  /** 生成查询向量使用的模型配置 ID。 */
  embeddingModelConfigId: string;
  /** 检索前用于校验查询向量的维度。 */
  embeddingDimension: number;
  /** 向量存储实现类型。 */
  vectorStoreType: "PGVECTOR";
  /** 隔离不同知识库向量的逻辑集合名称。 */
  vectorCollectionName: string;
};

/** Retrieval 模块通过 Knowledge Service 发起关键词召回，禁止跨模块直接查询 Chunk 表。 */
export type KnowledgeKeywordSearchRequest = {
  /** 已由知识库运行配置确认的项目空间。 */
  workspaceId: string;
  /** Agent 已绑定且当前启用的知识库。 */
  knowledgeBaseIds: string[];
  /** 归一化后的用户查询，服务端仍会限制最大长度。 */
  query: string;
  /** 关键词通道候选集上限。 */
  limit: number;
};

/** 关键词检索命中；字段与向量检索来源对齐，便于 Retrieval 模块无损融合。 */
export type KnowledgeKeywordSearchResult = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  /** FTS、trigram 与精确短语命中的综合分数，范围为 0-1。 */
  score: number;
};

/** 文件上传适配层传给 Knowledge Service 的最小文件结构。 */
export type UploadedKnowledgeFile = {
  /** 用户上传时的原始文件名。 */
  originalname: string;
  /** 上传中间件识别的 MIME 类型。 */
  mimetype: string;
  /** 文件字节数。 */
  size: number;
  /** 内存上传模式下的内容；磁盘模式可以为空。 */
  buffer?: Buffer;
};
