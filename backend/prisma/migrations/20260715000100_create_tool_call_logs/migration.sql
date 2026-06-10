CREATE TABLE "tool_call_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" TEXT,
  "agent_id" TEXT,
  "user_id" TEXT,
  "tool_call_id" TEXT,
  "tool_id" TEXT,
  "status" TEXT NOT NULL,
  "source" TEXT,
  "reason" TEXT,
  "input" JSONB,
  "output" JSONB,
  "error_type" TEXT,
  "error_message" TEXT,
  "elapsed_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tool_call_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_tool_call_logs_created_at" ON "tool_call_logs" ("created_at" DESC);
CREATE INDEX "idx_tool_call_logs_request_id" ON "tool_call_logs" ("request_id");
CREATE INDEX "idx_tool_call_logs_agent_id_created_at" ON "tool_call_logs" ("agent_id", "created_at" DESC);
CREATE INDEX "idx_tool_call_logs_tool_id_created_at" ON "tool_call_logs" ("tool_id", "created_at" DESC);
CREATE INDEX "idx_tool_call_logs_status_created_at" ON "tool_call_logs" ("status", "created_at" DESC);
