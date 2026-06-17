import { request, type PageResult } from "../../shared/api/client";

export type KnowledgeBaseListItem = {
  id: string;
  name: string;
  description: string;
  embeddingModelConfigId: string;
  embeddingModelName: string;
  embeddingProviderName: string;
  documentCount: number;
  chunkCount: number;
  failedDocumentCount: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseDetail = KnowledgeBaseListItem;

export type KnowledgeDocumentListItem = {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSize: string;
  status: string;
  errorMessage: string | null;
  chunkCount: number;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBasePayload = {
  name: string;
  description: string;
  embeddingModelConfigId: string;
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

  return request<KnowledgeDocumentListItem>(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents`, {
    method: "POST",
    body
  });
}

export function deleteKnowledgeDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<null> {
  return request<null>(`/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}`, {
    method: "DELETE"
  });
}
