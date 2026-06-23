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

export type KnowledgeDocumentQueryDto = {
  page?: string;
  pageSize?: string;
  status?: string;
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
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeBaseRetrievalConfig = {
  id: string;
  embeddingModelConfigId: string;
};

export type UploadedKnowledgeFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
};
