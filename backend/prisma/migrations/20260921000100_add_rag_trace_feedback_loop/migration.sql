ALTER TABLE "chat_message_feedbacks"
  ADD COLUMN "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "comment" TEXT,
  ADD COLUMN "corrected_answer" TEXT;

CREATE TABLE "rag_traces" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "request_id" TEXT NOT NULL,
  "session_id" UUID,
  "message_id" UUID,
  "user_id" UUID,
  "agent_id" UUID NOT NULL,
  "agent_config_snapshot" JSONB NOT NULL,
  "query" TEXT NOT NULL,
  "rewritten_query" TEXT,
  "retrieval_config_snapshot" JSONB NOT NULL,
  "candidate_chunks" JSONB NOT NULL,
  "selected_chunks" JSONB NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "model_config_snapshot" JSONB NOT NULL,
  "answer" TEXT NOT NULL,
  "citations" JSONB NOT NULL,
  "retrieval_elapsed_ms" INTEGER,
  "first_token_elapsed_ms" INTEGER,
  "total_elapsed_ms" INTEGER,
  "token_usage" JSONB,
  "status" TEXT NOT NULL,
  "error" JSONB,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rag_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_rag_traces_request_id" ON "rag_traces"("request_id");
CREATE INDEX "idx_rag_traces_message_id" ON "rag_traces"("message_id");
CREATE INDEX "idx_rag_traces_agent_created_at" ON "rag_traces"("agent_id", "created_at" DESC);
CREATE INDEX "idx_rag_traces_workspace_expires_at" ON "rag_traces"("workspace_id", "expires_at");

CREATE TABLE "log_events" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "request_id" TEXT,
  "event_type" TEXT NOT NULL,
  "user_id" UUID,
  "agent_id" UUID,
  "session_id" UUID,
  "message_id" UUID,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "log_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_log_events_workspace_type_created" ON "log_events"("workspace_id", "event_type", "created_at" DESC);
CREATE INDEX "idx_log_events_request_id" ON "log_events"("request_id");
