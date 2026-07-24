import { WorkflowGraph } from "./workflow.dto";

export type WorkflowVersionListItem = {
  id: string;
  workflowId: string;
  version: number;
  graphSchemaVersion: number;
  checksum: string;
  publishedByUserId: string;
  createdAt: Date;
};

export type WorkflowVersionDetail = WorkflowVersionListItem & {
  graph: WorkflowGraph;
  compiledPlan: Record<string, unknown>;
};

/** 跨模块只返回可序列化的已发布版本配置，不暴露 Prisma Model。 */
export type PublishedWorkflowRuntimeConfig = {
  workflowId: string;
  workflowVersionId: string;
  version: number;
  graphSchemaVersion: number;
  checksum: string;
  compiledPlan: Record<string, unknown>;
};
