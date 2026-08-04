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
