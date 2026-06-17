export type KnowledgeBaseCreateDto = {
  name?: string;
  description?: string;
  embeddingModelConfigId?: string;
  enabled?: boolean;
};

export type KnowledgeBaseUpdateDto = Partial<KnowledgeBaseCreateDto>;

export type KnowledgeBaseQueryDto = {
  page?: string;
  pageSize?: string;
  enabled?: string;
};

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
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeBaseDetail = KnowledgeBaseListItem;
