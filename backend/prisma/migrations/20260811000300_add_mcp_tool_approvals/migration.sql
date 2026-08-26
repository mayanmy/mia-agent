-- Run 与 Step 在等待成员确认时保留为可恢复状态，不应误记为失败或完成。
ALTER TYPE "agent_run_status" ADD VALUE 'WAITING_APPROVAL';
ALTER TYPE "agent_run_step_status" ADD VALUE 'WAITING_APPROVAL';

CREATE TYPE "mcp_tool_approval_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CONSUMED',
  'EXPIRED',
  'CANCELED'
);

-- 真实输入仅以应用层密文持久化；input_hash 绑定批准时看到的原始调用，防止参数替换。
CREATE TABLE "mcp_tool_approvals" (
  "id" UUID NOT NULL,
  "server_id" UUID NOT NULL,
  "tool_id" UUID NOT NULL,
  "runtime_id" TEXT NOT NULL,
  "run_id" UUID NOT NULL,
  "step_id" UUID,
  "tool_call_id" TEXT,
  "request_id" TEXT,
  "user_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "encrypted_input" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status" "mcp_tool_approval_status" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "decided_at" TIMESTAMPTZ(6),
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mcp_tool_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_mcp_tool_approvals_user_status_created_at"
  ON "mcp_tool_approvals"("user_id", "status", "created_at" DESC);
CREATE INDEX "idx_mcp_tool_approvals_run_status"
  ON "mcp_tool_approvals"("run_id", "status");
CREATE INDEX "idx_mcp_tool_approvals_expiry_status"
  ON "mcp_tool_approvals"("expires_at", "status");

ALTER TABLE "mcp_tool_approvals"
  ADD CONSTRAINT "mcp_tool_approvals_server_id_fkey"
  FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_tool_approvals"
  ADD CONSTRAINT "mcp_tool_approvals_tool_id_fkey"
  FOREIGN KEY ("tool_id") REFERENCES "mcp_server_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_tool_approvals"
  ADD CONSTRAINT "mcp_tool_approvals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
