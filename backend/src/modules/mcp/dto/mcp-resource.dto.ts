import { KnowledgeDocumentListItem } from "../../knowledge/dto/knowledge.dto";

export type McpResourceItem = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};

export type McpResourceTemplateItem = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type McpResourceCatalog = {
  resources: McpResourceItem[];
  templates: McpResourceTemplateItem[];
};

export type McpResourceReadDto = { uri?: string };

export type McpResourcePreview = {
  uri: string;
  mimeType: string;
  text: string;
  truncated: boolean;
  originalChars: number;
};

export type McpResourceImportDto = McpResourceReadDto & {
  knowledgeBaseId?: string;
  filename?: string;
};

export type McpResourceImportResult = {
  serverId: string;
  resourceUri: string;
  document: KnowledgeDocumentListItem;
};
