import type { KnowledgeBaseListItem } from "./api";

export type KnowledgeBaseFormValues = {
  name: string;
  description?: string;
  embeddingModelConfigId: string;
  enabled: boolean;
};

export type KnowledgeBaseTableItem = KnowledgeBaseListItem;
