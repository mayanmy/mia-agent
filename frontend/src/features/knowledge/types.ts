import type { KnowledgeBaseListItem, KnowledgeDocumentListItem } from "./api";

/** 知识库创建/编辑表单的受控字段。 */
export type KnowledgeBaseFormValues = {
  /** 知识库展示名称。 */
  name: string;
  /** 可选用途说明。 */
  description?: string;
  /** 创建时绑定的 Embedding 模型配置 ID。 */
  embeddingModelConfigId: string;
  /** 是否允许 Agent 检索。 */
  enabled: boolean;
};

/** 表格行别名，隔离组件与 API 类型命名。 */
export type KnowledgeBaseTableItem = KnowledgeBaseListItem;

/** 文档表格行别名，隔离组件与 API 类型命名。 */
export type KnowledgeDocumentTableItem = KnowledgeDocumentListItem;
