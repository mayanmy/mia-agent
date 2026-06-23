export type RetrievalSource = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  score: number;
};

export type RetrievalContext = {
  query: string;
  sources: RetrievalSource[];
  elapsedMs: number;
};
