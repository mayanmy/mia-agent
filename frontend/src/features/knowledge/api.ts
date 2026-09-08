import { request, type PageResult } from "../../shared/api/client";

/** 知识库列表接口返回的容量和模型摘要。 */
export type KnowledgeBaseListItem = {
  /** 知识库 ID。 */
  id: string;
  /** 展示名称。 */
  name: string;
  /** 用途说明。 */
  description: string;
  /** 固定绑定的 Embedding 模型配置 ID。 */
  embeddingModelConfigId: string;
  /** 向量维度。 */
  embeddingDimension: number;
  /** 当前向量存储实现。 */
  vectorStoreType: "PGVECTOR";
  /** 向量存储逻辑集合名称。 */
  vectorCollectionName: string;
  /** Embedding 模型展示名称。 */
  embeddingModelName: string;
  /** Embedding 供应商展示名称。 */
  embeddingProviderName: string;
  /** 未删除文档数。 */
  documentCount: number;
  /** 已生成切片数。 */
  chunkCount: number;
  /** 当前索引失败文档数。 */
  failedDocumentCount: number;
  /** 是否允许用于新检索。 */
  enabled: boolean;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式最近更新时间。 */
  updatedAt: string;
};

/** 当前详情与列表字段一致，保留别名稳定组件语义。 */
export type KnowledgeBaseDetail = KnowledgeBaseListItem;

/** 文档上传、解析、向量化和软删除的完整生命周期。 */
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

/** 文档抽屉接口返回的索引状态摘要。 */
export type KnowledgeDocumentListItem = {
  /** 文档 ID。 */
  id: string;
  /** 所属知识库 ID。 */
  knowledgeBaseId: string;
  /** 存储层安全文件名。 */
  filename: string;
  /** 用户上传时的原始文件名。 */
  originalFilename: string;
  /** 文件媒体类型。 */
  mimeType: string;
  /** 字节数使用字符串传输，避免大整数精度问题。 */
  fileSize: string;
  /** 当前生命周期状态。 */
  status: KnowledgeDocumentStatus;
  /** 失败时的管理员排障信息。 */
  errorMessage: string | null;
  /** 已保存切片数。 */
  chunkCount: number;
  /** 最近一次完整索引成功时间。 */
  indexedAt: string | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式最近更新时间。 */
  updatedAt: string;
};

/** 创建或更新知识库提交的字段。 */
export type KnowledgeBasePayload = {
  /** 知识库展示名称。 */
  name: string;
  /** 用途说明。 */
  description: string;
  /** Embedding 模型配置 ID。 */
  embeddingModelConfigId: string;
  /** 是否允许检索。 */
  enabled: boolean;
};

export function listKnowledgeBases(
  page = 1,
  pageSize = 20
): Promise<PageResult<KnowledgeBaseListItem>> {
  return request<PageResult<KnowledgeBaseListItem>>(
    `/api/v1/knowledge-bases?page=${page}&pageSize=${pageSize}`
  );
}

export function createKnowledgeBase(payload: KnowledgeBasePayload): Promise<KnowledgeBaseDetail> {
  return request<KnowledgeBaseDetail>("/api/v1/knowledge-bases", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getKnowledgeBase(id: string): Promise<KnowledgeBaseDetail> {
  return request<KnowledgeBaseDetail>(`/api/v1/knowledge-bases/${id}`);
}

export function updateKnowledgeBase(
  id: string,
  payload: KnowledgeBasePayload
): Promise<KnowledgeBaseDetail> {
  return request<KnowledgeBaseDetail>(`/api/v1/knowledge-bases/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteKnowledgeBase(id: string): Promise<null> {
  return request<null>(`/api/v1/knowledge-bases/${id}`, {
    method: "DELETE"
  });
}

export function listKnowledgeDocuments(
  knowledgeBaseId: string,
  page = 1,
  pageSize = 20
): Promise<PageResult<KnowledgeDocumentListItem>> {
  return request<PageResult<KnowledgeDocumentListItem>>(
    `/api/v1/knowledge-bases/${knowledgeBaseId}/documents?page=${page}&pageSize=${pageSize}`
  );
}

export function uploadKnowledgeDocument(
  knowledgeBaseId: string,
  file: File
): Promise<KnowledgeDocumentListItem> {
  const body = new FormData();
  body.append("file", file);

  // 文件名放在编码后的 Header 中，避免浏览器 FormData filename 在不同代理链路中乱码。
  return request<KnowledgeDocumentListItem>(
    `/api/v1/knowledge-bases/${knowledgeBaseId}/documents`,
    {
      method: "POST",
      headers: {
        "X-File-Name": encodeURIComponent(file.name)
      },
      body
    }
  );
}

export function reindexKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<KnowledgeDocumentListItem> {
  return request<KnowledgeDocumentListItem>(
    `/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/reindex`,
    {
      method: "POST"
    }
  );
}

export function deleteKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<null> {
  return request<null>(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`, {
    method: "DELETE"
  });
}
