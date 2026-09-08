import { AgentRunStepType } from "@prisma/client";

/** Run Trace 可安全持久化的 JSON 基础值，排除函数、句柄和 SDK 对象。 */
export type TraceJsonPrimitive = string | number | boolean | null;
/** Run Trace 输入输出允许使用的递归 JSON 值。 */
export type TraceJsonValue = TraceJsonPrimitive | TraceJsonObject | TraceJsonValue[];
/** Run Trace 中以字符串键组织的 JSON 对象。 */
export type TraceJsonObject = { [key: string]: TraceJsonValue };

/** 开始记录单个运行步骤所需的上下文。 */
export type StartAgentRunStepDto = {
  /** 所属 Agent Run ID。 */
  runId: string;
  /** Run 内严格递增的步骤序号。 */
  sequence: number;
  /** 用于分类统计的步骤类型。 */
  type: AgentRunStepType;
  /** 面向排障页面的步骤名称。 */
  name: string;
  /** Workflow 节点 ID；Agent Loop 步骤通常为空。 */
  nodeId?: string;
  /** 同一步骤的尝试次数，从 1 开始。 */
  attempt?: number;
  /** 执行前输入快照，必须可 JSON 序列化。 */
  input?: TraceJsonValue;
};

/** 步骤创建后返回给编排层的稳定追踪上下文。 */
export type AgentRunStepContext = {
  /** 新建步骤记录 ID。 */
  stepId: string;
  /** 所属 Agent Run ID。 */
  runId: string;
  /** Run 内步骤序号。 */
  sequence: number;
  /** 服务端记录的实际开始时间。 */
  startedAt: Date;
};
