import { CompiledWorkflowPlan } from "./compiled-plan.dto";
import { WorkflowGraph } from "./workflow-graph.dto";

/** Workflow 校验问题的严重级别；error 阻止发布，warning 仅提示。 */
export type WorkflowValidationSeverity = "error" | "warning";

/** 定位到 Graph、节点或字段的单条校验问题。 */
export type WorkflowValidationIssue = {
  /** 供前端分类和测试断言使用的稳定错误码。 */
  code: string;
  /** 问题严重级别。 */
  severity: WorkflowValidationSeverity;
  /** 面向管理员的中文说明。 */
  message: string;
  /** 关联节点 ID；Graph 级问题为空。 */
  nodeId?: string;
  /** 关联配置字段路径。 */
  field?: string;
};

/** 校验指定 Graph 的请求。 */
export type WorkflowValidateDto = {
  /** 待校验 Graph；Service 会拒绝缺失值。 */
  graph?: WorkflowGraph;
};

/** 发布 Workflow 草稿的乐观锁参数。 */
export type WorkflowPublishDto = {
  /** 客户端最后读取的草稿修订号。 */
  expectedRevision?: number;
  /** 客户端刚刚校验通过的编译摘要，用于绑定校验结果与发布内容。 */
  expectedChecksum?: string;
};

/** Compiler 返回的校验、计划和内容摘要。 */
export type WorkflowValidationResult = {
  /** 是否不存在阻止执行或发布的错误。 */
  valid: boolean;
  /** 全部错误和警告。 */
  issues: WorkflowValidationIssue[];
  /** 校验成功时生成的可信执行计划。 */
  compiledPlan?: CompiledWorkflowPlan;
  /** 编译计划的稳定内容摘要。 */
  checksum?: string;
};

/** 创建不可变 Workflow Version 后的发布结果。 */
export type WorkflowPublishResult = {
  /** Workflow ID。 */
  workflowId: string;
  /** 新创建的不可变版本 ID。 */
  workflowVersionId: string;
  /** Workflow 内单调递增的版本号。 */
  version: number;
  /** 发布时编译计划的内容摘要。 */
  checksum: string;
  /** 发布完成时间。 */
  publishedAt: Date;
};
