import { WorkflowGraph } from "./workflow-graph.dto";

/** Workflow 历史版本列表摘要。 */
export type WorkflowVersionListItem = {
  /** 不可变版本 ID。 */
  id: string;
  /** 所属 Workflow ID。 */
  workflowId: string;
  /** Workflow 内单调递增的版本号。 */
  version: number;
  /** 该版本 Graph 的 Schema 版本。 */
  graphSchemaVersion: number;
  /** 编译计划内容摘要。 */
  checksum: string;
  /** 执行发布操作的管理员 ID。 */
  publishedByUserId: string;
  /** 版本创建时间。 */
  createdAt: Date;
};

/** Workflow 不可变版本的完整详情。 */
export type WorkflowVersionDetail = WorkflowVersionListItem & {
  /** 用于版本回显的原始 Graph 快照。 */
  graph: WorkflowGraph;
  /** 供 Runtime 执行的编译计划。 */
  compiledPlan: Record<string, unknown>;
};

/** 跨模块只返回可序列化的已发布版本配置，不暴露 Prisma Model。 */
export type PublishedWorkflowRuntimeConfig = {
  /** Workflow ID。 */
  workflowId: string;
  /** 不可变版本 ID。 */
  workflowVersionId: string;
  /** Workflow 内版本号。 */
  version: number;
  /** Graph Schema 版本。 */
  graphSchemaVersion: number;
  /** 编译计划内容摘要。 */
  checksum: string;
  /** Runtime 可直接读取的编译计划。 */
  compiledPlan: Record<string, unknown>;
};

/** 独立运行页面和 Workflow Tool 共同使用的输入字段。 */
export type PublishedWorkflowInput = {
  /** Start 节点中的稳定变量名。 */
  name: string;
  /** Runtime 支持的 JSON 输入类型。 */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** 是否必须由调用方提供。 */
  required: boolean;
  /** 面向成员和模型的输入说明。 */
  description: string;
  /** 可选默认值。 */
  defaultValue?: unknown;
};

/** 已发布 Workflow 的独立应用摘要。 */
export type PublishedWorkflowApp = {
  /** Workflow ID。 */
  workflowId: string;
  /** Workflow 展示名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
  /** 当前不可变发布版本 ID。 */
  workflowVersionId: string;
  /** 当前发布版本号。 */
  version: number;
  /** Start 节点派生的运行输入表单。 */
  inputs: PublishedWorkflowInput[];
  /** ISO 格式发布时间。 */
  publishedAt: Date;
};
