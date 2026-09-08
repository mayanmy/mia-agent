import { WorkflowRunMode } from "@prisma/client";

/** 调用 Workflow Runtime 的统一请求。 */
export type WorkflowRunRequest = {
  requestId: string;
  runId?: string;
  /** Agent 调用时存在；独立 Workflow 应用运行时为空。 */
  agentId?: string;
  userId?: string;
  sessionId?: string;
  workflowId: string;
  workflowVersionId: string;
  mode: WorkflowRunMode;
  inputs: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Workflow Runtime 对外稳定的节点级错误。 */
export type WorkflowRuntimeErrorData = {
  type: string;
  message: string;
  nodeId?: string;
  retryable: boolean;
};

/** Workflow Runtime 流式状态与 token 事件联合。 */
export type WorkflowRuntimeEvent =
  | { type: "workflow_started"; data: Record<string, unknown> }
  | { type: "node_started"; data: Record<string, unknown> }
  | { type: "node_completed"; data: Record<string, unknown> }
  | { type: "node_failed"; data: Record<string, unknown> }
  | { type: "token"; data: { content: string } }
  | { type: "workflow_completed"; data: Record<string, unknown> }
  | { type: "workflow_failed"; data: { error: WorkflowRuntimeErrorData } }
  | { type: "workflow_canceled"; data: Record<string, unknown> };

/** 独立 Workflow 应用运行请求。 */
export type WorkflowAppRunDto = {
  /** 要执行的当前发布版本，防止页面基于旧表单误调用新版本。 */
  workflowVersionId?: string;
  /** Start 节点声明的输入值。 */
  inputs?: Record<string, unknown>;
};

/** 独立 Workflow 应用的阻塞式运行结果。 */
export type WorkflowAppRunResult = {
  /** 本次请求链路 ID。 */
  requestId: string;
  /** Workflow ID。 */
  workflowId: string;
  /** 实际执行的不可变版本 ID。 */
  workflowVersionId: string;
  /** 是否成功到达 End 节点。 */
  ok: boolean;
  /** End 节点结构化输出。 */
  output?: Record<string, unknown>;
  /** 失败时的稳定错误。 */
  error?: WorkflowRuntimeErrorData;
  /** 调试和前端步骤摘要使用的完整 Runtime 事件。 */
  events: WorkflowRuntimeEvent[];
};
