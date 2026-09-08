import { KnowledgeDocumentListItem } from "../../knowledge/dto/knowledge.dto";

/** MCP Server 暴露的静态资源目录项。 */
export type McpResourceItem = {
  /** 读取资源时使用的唯一 URI。 */
  uri: string;
  /** 资源稳定名称。 */
  name: string;
  /** 可选展示标题。 */
  title?: string;
  /** 资源用途说明。 */
  description?: string;
  /** Server 声明的媒体类型。 */
  mimeType?: string;
  /** Server 可选提供的字节数。 */
  size?: number;
};

/** MCP Server 暴露的参数化资源模板。 */
export type McpResourceTemplateItem = {
  /** 包含模板变量的 RFC 6570 风格 URI。 */
  uriTemplate: string;
  /** 模板稳定名称。 */
  name: string;
  /** 可选展示标题。 */
  title?: string;
  /** 模板用途说明。 */
  description?: string;
  /** 模板实例预期返回的媒体类型。 */
  mimeType?: string;
};

/** MCP 资源与资源模板的合并目录。 */
export type McpResourceCatalog = {
  /** 可直接读取的静态资源。 */
  resources: McpResourceItem[];
  /** 需要先补全参数的资源模板。 */
  templates: McpResourceTemplateItem[];
};

/** 读取单个 MCP 资源的输入。 */
export type McpResourceReadDto = { uri?: string };

/** 将 MCP 文本或二进制内容转换后的受限预览。 */
export type McpResourcePreview = {
  /** 实际读取的资源 URI。 */
  uri: string;
  /** MCP 内容声明的媒体类型。 */
  mimeType: string;
  /** 可安全展示的文本或二进制摘要。 */
  text: string;
  /** 是否因预览上限而截断。 */
  truncated: boolean;
  /** 截断前的字符数。 */
  originalChars: number;
};

/** 将 MCP 资源导入知识库时的目标与文件名。 */
export type McpResourceImportDto = McpResourceReadDto & {
  /** 目标知识库 ID。 */
  knowledgeBaseId?: string;
  /** 覆盖 URI 推导结果的文档文件名。 */
  filename?: string;
};

/** MCP 资源导入完成后的来源和知识文档记录。 */
export type McpResourceImportResult = {
  /** 来源 MCP Server ID。 */
  serverId: string;
  /** 来源资源 URI。 */
  resourceUri: string;
  /** 已进入知识库索引流程的文档。 */
  document: KnowledgeDocumentListItem;
};
