import { createHmac } from "node:crypto";

export type ToolLogicalOperation = {
  rootRunId: string;
  workflowVersionId: string;
  nodeId: string;
  originalAttempt: number;
};

/** 逻辑操作 ID 不使用重放 Run ID，确保同一节点恢复时仍命中同一个副作用账本。 */
export function createLogicalOperationId(operation: ToolLogicalOperation): string {
  if (
    !operation.rootRunId ||
    !operation.workflowVersionId ||
    !operation.nodeId ||
    !Number.isInteger(operation.originalAttempt) ||
    operation.originalAttempt < 1
  ) {
    throw new Error("逻辑操作标识参数无效");
  }
  return [
    operation.rootRunId,
    operation.workflowVersionId,
    operation.nodeId,
    operation.originalAttempt
  ].join(":");
}

/** 对外只传不可逆 HMAC；原始 Run/Node 标识和用户输入都不进入幂等键。 */
export function deriveIdempotencyKey(secret: string, logicalOperationId: string): string {
  if (!secret || !logicalOperationId) throw new Error("幂等键参数无效");
  return createHmac("sha256", secret).update(logicalOperationId).digest("base64url");
}
