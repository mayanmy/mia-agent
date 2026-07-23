-- Run Trace 使用独立枚举约束生命周期，避免业务代码写入无法统计的任意状态字符串。
CREATE TYPE "agent_run_source" AS ENUM ('INTERNAL_CHAT', 'PUBLIC_WIDGET', 'SERVICE_API', 'ASYNC_TASK');
CREATE TYPE "agent_run_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT');
CREATE TYPE "agent_run_step_type" AS ENUM ('RETRIEVAL', 'MODEL', 'TOOL', 'HOOK', 'SUBAGENT');
CREATE TYPE "agent_run_step_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'SKIPPED');

CREATE TABLE "agent_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" TEXT NOT NULL,
  "source" "agent_run_source" NOT NULL,
  "agent_id" UUID NOT NULL,
  "user_id" UUID,
  "session_id" UUID,
  "external_conversation_id" UUID,
  "status" "agent_run_status" NOT NULL DEFAULT 'QUEUED',
  "model_config_id" UUID,
  "input_preview" TEXT NOT NULL,
  "output_preview" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "estimated_cost" DECIMAL(12, 6),
  "first_token_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "error_type" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "agent_run_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "agent_run_step_type" NOT NULL,
  "name" TEXT NOT NULL,
  "status" "agent_run_step_status" NOT NULL DEFAULT 'RUNNING',
  "input" JSONB,
  "output" JSONB,
  "elapsed_ms" INTEGER,
  "error_type" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "uq_agent_run_steps_run_sequence" UNIQUE ("run_id", "sequence")
);

ALTER TABLE "tool_call_logs" ADD COLUMN "run_id" UUID;
ALTER TABLE "tool_call_logs" ADD COLUMN "step_id" UUID;

CREATE INDEX "idx_agent_runs_request_id" ON "agent_runs"("request_id");
CREATE INDEX "idx_agent_runs_agent_created_at" ON "agent_runs"("agent_id", "created_at" DESC);
CREATE INDEX "idx_agent_runs_user_created_at" ON "agent_runs"("user_id", "created_at" DESC);
CREATE INDEX "idx_agent_runs_status_created_at" ON "agent_runs"("status", "created_at" DESC);
CREATE INDEX "idx_agent_runs_session_created_at" ON "agent_runs"("session_id", "created_at" DESC);
CREATE INDEX "idx_agent_runs_external_conversation_created_at" ON "agent_runs"("external_conversation_id", "created_at" DESC);
CREATE INDEX "idx_agent_run_steps_run_sequence" ON "agent_run_steps"("run_id", "sequence");
CREATE INDEX "idx_agent_run_steps_type_started_at" ON "agent_run_steps"("type", "started_at" DESC);
CREATE INDEX "idx_agent_run_steps_status_started_at" ON "agent_run_steps"("status", "started_at" DESC);
CREATE INDEX "idx_tool_call_logs_run_id" ON "tool_call_logs"("run_id");
CREATE INDEX "idx_tool_call_logs_step_id" ON "tool_call_logs"("step_id");
