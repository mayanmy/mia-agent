import { CompiledWorkflowPlan } from "./compiled-plan.dto";
import { WorkflowGraph } from "./workflow-graph.dto";

export type WorkflowValidationSeverity = "error" | "warning";

export type WorkflowValidationIssue = {
  code: string;
  severity: WorkflowValidationSeverity;
  message: string;
  nodeId?: string;
  field?: string;
};

export type WorkflowValidateDto = {
  graph?: WorkflowGraph;
};

export type WorkflowPublishDto = {
  expectedRevision?: number;
};

export type WorkflowValidationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  compiledPlan?: CompiledWorkflowPlan;
  checksum?: string;
};

export type WorkflowPublishResult = {
  workflowId: string;
  workflowVersionId: string;
  version: number;
  checksum: string;
  publishedAt: Date;
};
