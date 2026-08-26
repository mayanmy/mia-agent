export type McpApprovalJsonValue =
  | string
  | number
  | boolean
  | null
  | McpApprovalJsonValue[]
  | { [key: string]: McpApprovalJsonValue };

export type McpToolApprovalCreateRequest = {
  runtimeId: string;
  input: Record<string, McpApprovalJsonValue>;
  runId: string;
  stepId?: string;
  toolCallId?: string;
  requestId?: string;
  userId: string;
  agentId: string;
};

export type McpToolApprovalDetail = {
  id: string;
  runtimeId: string;
  runId: string;
  toolCallId?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CONSUMED" | "EXPIRED" | "CANCELED";
  expiresAt: string;
};

export type McpToolApprovalDecision = {
  approved: boolean;
  status: McpToolApprovalDetail["status"];
};

export type McpToolApprovalConsumeRequest = {
  approvalId: string;
  runtimeId: string;
  input: Record<string, McpApprovalJsonValue>;
  userId: string;
  agentId: string;
  runId: string;
};
