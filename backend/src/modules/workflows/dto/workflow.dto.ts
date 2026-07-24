import { WorkflowStatus } from "@prisma/client";
import { WorkflowGraph } from "./workflow-graph.dto";

export type { WorkflowGraph } from "./workflow-graph.dto";

export type WorkflowCreateDto = {
  name?: string;
  description?: string;
  graph?: WorkflowGraph;
};

export type WorkflowUpdateDto = {
  name?: string;
  description?: string;
};

export type WorkflowDraftUpdateDto = {
  expectedRevision?: number;
  graph?: WorkflowGraph;
};

export type WorkflowQueryDto = {
  page?: string;
  pageSize?: string;
  status?: string;
};

export type WorkflowListItem = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  draftRevision: number;
  publishedVersion: number | null;
  versionCount: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowDetail = WorkflowListItem & {
  draftGraph: WorkflowGraph;
};

export type WorkflowDraftUpdateResult = {
  workflowId: string;
  draftRevision: number;
  updatedAt: Date;
};
