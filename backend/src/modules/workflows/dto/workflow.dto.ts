import { WorkflowStatus } from "@prisma/client";
import { WorkflowGraph } from "./workflow-graph.dto";

export type { WorkflowGraph } from "./workflow-graph.dto";

/** 创建 Workflow 草稿的输入。 */
export type WorkflowCreateDto = {
  /** Workflow 名称。 */
  name?: string;
  /** Workflow 用途说明。 */
  description?: string;
  /** 初始 Graph；缺失时由调用方提供默认骨架。 */
  graph?: WorkflowGraph;
};

/** 更新 Workflow 基础元数据的输入。 */
export type WorkflowUpdateDto = {
  /** 新 Workflow 名称。 */
  name?: string;
  /** 新用途说明。 */
  description?: string;
};

/** 使用乐观锁保存 Workflow 草稿的输入。 */
export type WorkflowDraftUpdateDto = {
  /** 客户端最后读取的草稿修订号。 */
  expectedRevision?: number;
  /** 待保存的完整 Graph 快照。 */
  graph?: WorkflowGraph;
};

/** Workflow 列表分页和状态筛选参数。 */
export type WorkflowQueryDto = {
  /** 从 1 开始的页码。 */
  page?: string;
  /** 每页记录数。 */
  pageSize?: string;
  /** Workflow 状态筛选字符串。 */
  status?: string;
};

/** Workflow 管理列表中的摘要信息。 */
export type WorkflowListItem = {
  /** Workflow ID。 */
  id: string;
  /** Workflow 名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
  /** 草稿、已发布或已归档状态。 */
  status: WorkflowStatus;
  /** 当前草稿修订号。 */
  draftRevision: number;
  /** 最近发布版本号；从未发布时为 null。 */
  publishedVersion: number | null;
  /** 已保存的不可变版本数量。 */
  versionCount: number;
  /** 创建管理员用户 ID。 */
  createdByUserId: string;
  /** Workflow 创建时间。 */
  createdAt: Date;
  /** Workflow 最近更新时间。 */
  updatedAt: Date;
};

/** Workflow 编辑页详情。 */
export type WorkflowDetail = WorkflowListItem & {
  /** 当前可编辑的完整草稿 Graph。 */
  draftGraph: WorkflowGraph;
};

/** 草稿保存成功后的新修订信息。 */
export type WorkflowDraftUpdateResult = {
  /** Workflow ID。 */
  workflowId: string;
  /** 保存后递增的草稿修订号。 */
  draftRevision: number;
  /** 服务端更新时间。 */
  updatedAt: Date;
};
