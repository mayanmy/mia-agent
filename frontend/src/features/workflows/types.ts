/** Workflow 编辑器和 Runtime 支持的节点类型。 */
export type WorkflowNodeType =
  "start" | "llm" | "retrieval" | "tool" | "condition" | "template" | "end";

/** 节点在画布中的坐标。 */
export type WorkflowNodePosition = {
  /** 相对画布左侧的横坐标。 */
  x: number;
  /** 相对画布顶部的纵坐标。 */
  y: number;
};

/** Workflow Graph 中的通用节点。 */
export type WorkflowNode = {
  /** Graph 内唯一节点 ID，也是变量引用路径的一部分。 */
  id: string;
  /** 节点执行和配置类型。 */
  type: WorkflowNodeType;
  /** 画布和 Trace 中展示的节点名称。 */
  name: string;
  /** 节点业务配置，由后端 Compiler 最终校验。 */
  config: Record<string, unknown>;
  /** 编辑器画布位置，不参与 Runtime 语义。 */
  position?: WorkflowNodePosition;
};

/** Workflow Graph 中的一条有向连线。 */
export type WorkflowEdge = {
  /** Graph 内唯一连线 ID。 */
  id: string;
  /** 起点节点 ID。 */
  source: string;
  /** 终点节点 ID。 */
  target: string;
  /** Condition 等多出口节点的分支 Handle。 */
  sourceHandle?: string;
};

/** 前端编辑和后端保存共同使用的 Workflow V1 Graph。 */
export type WorkflowGraph = {
  /** Graph Schema 版本。 */
  schemaVersion: 1;
  /** 全部节点。 */
  nodes: WorkflowNode[];
  /** 全部有向连线。 */
  edges: WorkflowEdge[];
};

/** Workflow 的管理生命周期状态。 */
export type WorkflowStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

/** Workflow 左侧列表使用的摘要。 */
export type WorkflowListItem = {
  /** Workflow ID。 */
  id: string;
  /** Workflow 名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
  /** 当前管理状态。 */
  status: WorkflowStatus;
  /** 当前草稿修订号。 */
  draftRevision: number;
  /** 最近发布版本号；从未发布时为 null。 */
  publishedVersion: number | null;
  /** 历史不可变版本数量。 */
  versionCount: number;
  /** 创建管理员 ID。 */
  createdByUserId: string;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式更新时间。 */
  updatedAt: string;
};

/** Workflow 编辑页完整详情。 */
export type WorkflowDetail = WorkflowListItem & {
  /** 当前可编辑草稿 Graph。 */
  draftGraph: WorkflowGraph;
};

/** 后端校验返回的单条错误或警告。 */
export type WorkflowValidationIssue = {
  /** 稳定问题编码。 */
  code: string;
  /** error 会阻止发布，warning 仅提示。 */
  severity: "error" | "warning";
  /** 面向管理员的说明。 */
  message: string;
  /** 关联节点 ID；Graph 级问题为空。 */
  nodeId?: string;
  /** 关联配置字段路径。 */
  field?: string;
};

/** Workflow 校验结果。 */
export type WorkflowValidationResult = {
  /** 是否可以执行或发布。 */
  valid: boolean;
  /** 全部错误和警告。 */
  issues: WorkflowValidationIssue[];
  /** 校验成功时编译计划的内容摘要。 */
  checksum?: string;
};

/** 发布不可变版本后的结果。 */
export type WorkflowPublishResult = {
  /** Workflow ID。 */
  workflowId: string;
  /** 新版本 ID。 */
  workflowVersionId: string;
  /** Workflow 内版本号。 */
  version: number;
  /** 编译计划内容摘要。 */
  checksum: string;
  /** ISO 格式发布时间。 */
  publishedAt: string;
};

/** Workflow Inspector 可选择的资源摘要。 */
export type WorkflowResourceOption = {
  /** 资源 ID。 */
  id: string;
  /** 下拉框展示名称。 */
  label: string;
};

/** Workflow 编辑器加载的跨模块资源选项。 */
export type WorkflowResources = {
  /** 可绑定的 Chat 模型配置。 */
  models: WorkflowResourceOption[];
  /** 可用于 Retrieval 节点的知识库。 */
  knowledgeBases: WorkflowResourceOption[];
  /** 可用于 Tool 节点的工具。 */
  tools: WorkflowResourceOption[];
};

/** 画布回放 Run Trace 时支持的节点状态。 */
export type WorkflowTraceNodeStatus = "COMPLETED" | "FAILED" | "CANCELED" | "RUNNING" | "SKIPPED";
