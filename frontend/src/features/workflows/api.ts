import { request, type PageResult } from "../../shared/api/client";
import type {
  WorkflowDetail,
  WorkflowGraph,
  WorkflowListItem,
  WorkflowPublishResult,
  WorkflowValidationResult
} from "./types";

/** 创建 Workflow 的请求载荷。 */
export type CreateWorkflowPayload = {
  /** Workflow 名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
  /** 初始草稿 Graph。 */
  graph: WorkflowGraph;
};

/** 更新 Workflow 基础信息的请求载荷。 */
export type UpdateWorkflowPayload = {
  /** 新 Workflow 名称。 */
  name: string;
  /** 新 Workflow 用途说明。 */
  description: string;
};

/** 保存草稿后返回的新修订信息。 */
export type WorkflowDraftUpdateResult = {
  /** Workflow ID。 */
  workflowId: string;
  /** 保存后递增的草稿修订号。 */
  draftRevision: number;
  /** ISO 格式更新时间。 */
  updatedAt: string;
};

/** 分页读取 Workflow 管理列表。 */
export function listWorkflows(page = 1, pageSize = 100): Promise<PageResult<WorkflowListItem>> {
  return request(`/api/v1/workflows?page=${page}&pageSize=${pageSize}`);
}

/** 创建 Workflow 及其初始草稿。 */
export function createWorkflow(payload: CreateWorkflowPayload): Promise<WorkflowDetail> {
  return request("/api/v1/workflows", { method: "POST", body: JSON.stringify(payload) });
}

/** 获取 Workflow 编辑详情。 */
export function getWorkflow(id: string): Promise<WorkflowDetail> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}`);
}

/** 更新名称和描述；该操作不改变 Graph 和草稿修订号。 */
export function updateWorkflow(
  id: string,
  payload: UpdateWorkflowPayload
): Promise<WorkflowDetail> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/** 使用乐观锁保存完整草稿 Graph。 */
export function updateWorkflowDraft(
  id: string,
  expectedRevision: number,
  graph: WorkflowGraph
): Promise<WorkflowDraftUpdateResult> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    body: JSON.stringify({ expectedRevision, graph })
  });
}

/** 编译校验当前页面 Graph，不直接修改草稿。 */
export function validateWorkflow(
  id: string,
  graph: WorkflowGraph
): Promise<WorkflowValidationResult> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    body: JSON.stringify({ graph })
  });
}

/** 将指定草稿修订发布为不可变版本。 */
export function publishWorkflow(
  id: string,
  expectedRevision: number,
  expectedChecksum: string
): Promise<WorkflowPublishResult> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision, expectedChecksum })
  });
}

/** 归档 Workflow 并从默认管理列表移除。 */
export function archiveWorkflow(id: string): Promise<null> {
  return request(`/api/v1/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
}
