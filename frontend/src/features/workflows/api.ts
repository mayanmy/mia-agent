import { request, type PageResult } from "../../shared/api/client";
import type {
  WorkflowDetail,
  WorkflowGraph,
  WorkflowListItem,
  WorkflowPublishResult,
  WorkflowValidationResult
} from "./types";

export function listWorkflows(page = 1, pageSize = 100): Promise<PageResult<WorkflowListItem>> {
  return request(`/api/v1/workflows?page=${page}&pageSize=${pageSize}`);
}

export function createWorkflow(payload: {
  name: string;
  description: string;
  graph: WorkflowGraph;
}): Promise<WorkflowDetail> {
  return request("/api/v1/workflows", { method: "POST", body: JSON.stringify(payload) });
}

export function getWorkflow(id: string): Promise<WorkflowDetail> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}`);
}

export function updateWorkflowDraft(
  id: string,
  expectedRevision: number,
  graph: WorkflowGraph
): Promise<{ workflowId: string; draftRevision: number; updatedAt: string }> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    body: JSON.stringify({ expectedRevision, graph })
  });
}

export function validateWorkflow(
  id: string,
  graph: WorkflowGraph
): Promise<WorkflowValidationResult> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    body: JSON.stringify({ graph })
  });
}

export function publishWorkflow(
  id: string,
  expectedRevision: number
): Promise<WorkflowPublishResult> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision })
  });
}

export function archiveWorkflow(id: string): Promise<null> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}
