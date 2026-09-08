/** MCP 工具审批记录允许持久化的递归 JSON 值。 */
export type McpApprovalJsonValue =
  | string
  | number
  | boolean
  | null
  | McpApprovalJsonValue[]
  | { [key: string]: McpApprovalJsonValue };

/** 创建高风险 MCP 工具审批时保存的完整绑定上下文。 */
export type McpToolApprovalCreateRequest = {
  /** MCP 工具运行时 ID。 */
  runtimeId: string;
  /** 待审批且后续必须原样匹配的工具输入。 */
  input: Record<string, McpApprovalJsonValue>;
  /** 审批所属 Run ID。 */
  runId: string;
  /** 审批所属步骤 ID。 */
  stepId?: string;
  /** 模型生成的工具调用 ID。 */
  toolCallId?: string;
  /** 贯穿日志的链路 ID。 */
  requestId?: string;
  /** 唯一允许作出决定的成员 ID。 */
  userId: string;
  /** 防止审批跨 Agent 被复用的 Agent ID。 */
  agentId: string;
};

/** 交互式审批挂起和恢复流程需要的安全摘要。 */
export type McpToolApprovalDetail = {
  /** 一次性审批记录 ID。 */
  id: string;
  /** 待执行工具运行时 ID。 */
  runtimeId: string;
  /** 审批所属 Run ID。 */
  runId: string;
  /** 模型生成的工具调用 ID。 */
  toolCallId?: string;
  /** 审批状态机；CONSUMED 后不可再次执行。 */
  status: "PENDING" | "APPROVED" | "REJECTED" | "CONSUMED" | "EXPIRED" | "CANCELED";
  /** 审批自动失效的 ISO 时间。 */
  expiresAt: string;
};

/** 用户作出审批决定后的状态。 */
export type McpToolApprovalDecision = {
  /** 是否允许本次工具调用。 */
  approved: boolean;
  /** 决定落库后的实际状态。 */
  status: McpToolApprovalDetail["status"];
};

/** 执行前消费审批记录时必须再次匹配的防重放上下文。 */
export type McpToolApprovalConsumeRequest = {
  /** 待消费的一次性审批 ID。 */
  approvalId: string;
  /** 必须与审批创建时一致的工具 ID。 */
  runtimeId: string;
  /** 必须与审批创建时结构化一致的输入。 */
  input: Record<string, McpApprovalJsonValue>;
  /** 必须与审批创建时一致的成员 ID。 */
  userId: string;
  /** 必须与审批创建时一致的 Agent ID。 */
  agentId: string;
  /** 必须与审批创建时一致的 Run ID。 */
  runId: string;
};
