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

/** 已发布 Workflow 的单个运行输入。 */
export type PublishedWorkflowInput = {
  /** Start 节点变量名。 */
  name: string;
  /** Runtime 支持的 JSON 类型。 */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** 是否必填。 */
  required: boolean;
  /** 输入说明。 */
  description: string;
  /** 可选默认值。 */
  defaultValue?: unknown;
};

/** 独立运行页面使用的已发布 Workflow 摘要。 */
export type PublishedWorkflowApp = {
  /** Workflow ID。 */
  workflowId: string;
  /** Workflow 名称。 */
  name: string;
  /** Workflow 描述。 */
  description: string;
  /** 当前不可变版本 ID。 */
  workflowVersionId: string;
  /** 当前版本号。 */
  version: number;
  /** 动态运行表单定义。 */
  inputs: PublishedWorkflowInput[];
  /** ISO 格式发布时间。 */
  publishedAt: string;
};

/** 独立运行返回的错误。 */
export type WorkflowRunError = {
  /** 稳定错误类型。 */
  type: string;
  /** 面向用户的错误说明。 */
  message: string;
  /** 是否适合重试。 */
  retryable: boolean;
  /** 发生错误的节点 ID。 */
  nodeId?: string;
};

/** 独立 Workflow 阻塞运行结果。 */
export type WorkflowAppRunResult = {
  /** 请求链路 ID。 */
  requestId: string;
  /** Workflow ID。 */
  workflowId: string;
  /** 实际运行版本。 */
  workflowVersionId: string;
  /** 是否成功。 */
  ok: boolean;
  /** End 节点输出。 */
  output?: Record<string, unknown>;
  /** 失败详情。 */
  error?: WorkflowRunError;
  /** Runtime 事件，用于展示节点摘要。 */
  events: Array<{ type: string; data: Record<string, unknown> }>;
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

/** 读取已发布 Workflow 的独立运行表单。 */
export function getPublishedWorkflowApp(id: string): Promise<PublishedWorkflowApp> {
  return request(`/api/v1/workflow-apps/${encodeURIComponent(id)}`);
}

/** 返回可被 Agent 绑定的全部已发布 Workflow。 */
export function listPublishedWorkflowApps(): Promise<PublishedWorkflowApp[]> {
  return request("/api/v1/workflow-apps");
}

/** 独立运行明确的已发布 Workflow 版本。 */
export function runPublishedWorkflow(
  app: PublishedWorkflowApp,
  inputs: Record<string, unknown>
): Promise<WorkflowAppRunResult> {
  return request(`/api/v1/workflow-apps/${encodeURIComponent(app.workflowId)}/runs`, {
    method: "POST",
    body: JSON.stringify({ workflowVersionId: app.workflowVersionId, inputs })
  });
}

/** 生成与后端一致的版本化 Workflow Tool ID。 */
export function workflowToolId(app: PublishedWorkflowApp): string {
  return `workflow:${app.workflowId}:${app.workflowVersionId}`;
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
