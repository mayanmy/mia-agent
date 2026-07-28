export type WorkflowNodeType =
  "start" | "llm" | "retrieval" | "tool" | "condition" | "template" | "end";

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

export type WorkflowGraph = {
  schemaVersion: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type WorkflowListItem = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  draftRevision: number;
  publishedVersion: number | null;
  versionCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDetail = WorkflowListItem & { draftGraph: WorkflowGraph };

export type WorkflowValidationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  field?: string;
};

export type WorkflowValidationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  checksum?: string;
};

export type WorkflowPublishResult = {
  workflowId: string;
  workflowVersionId: string;
  version: number;
  checksum: string;
  publishedAt: string;
};

export type WorkflowResources = {
  models: Array<{ id: string; label: string }>;
  knowledgeBases: Array<{ id: string; label: string }>;
  tools: Array<{ id: string; label: string }>;
};

export type WorkflowTraceNodeStatus = "COMPLETED" | "FAILED" | "CANCELED" | "RUNNING" | "SKIPPED";
