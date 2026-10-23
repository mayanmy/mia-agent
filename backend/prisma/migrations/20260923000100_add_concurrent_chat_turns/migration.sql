CREATE TYPE "chat_turn_status" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED', 'CANCELED');

ALTER TABLE "chat_sessions"
  ADD COLUMN "next_turn_sequence" BIGINT NOT NULL DEFAULT 1;

CREATE TABLE "chat_turns" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "sequence" BIGINT NOT NULL,
  "client_message_id" TEXT NOT NULL,
  "user_message_id" UUID,
  "assistant_message_id" UUID,
  "run_id" UUID,
  "status" "chat_turn_status" NOT NULL DEFAULT 'QUEUED',
  "error_type" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "chat_session_messages"
  ADD COLUMN "turn_id" UUID,
  ADD COLUMN "turn_sequence" BIGINT,
  ADD COLUMN "turn_position" INTEGER;

ALTER TABLE "chat_session_messages"
  ADD CONSTRAINT "chat_session_messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "chat_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "chat_turns_user_message_id_key" ON "chat_turns"("user_message_id");
CREATE UNIQUE INDEX "chat_turns_assistant_message_id_key" ON "chat_turns"("assistant_message_id");
CREATE UNIQUE INDEX "uq_chat_turns_session_sequence" ON "chat_turns"("session_id", "sequence");
CREATE UNIQUE INDEX "uq_chat_turns_session_client_message" ON "chat_turns"("session_id", "client_message_id");
CREATE INDEX "idx_chat_turns_session_status_sequence" ON "chat_turns"("session_id", "status", "sequence");
CREATE INDEX "idx_chat_session_messages_turn_order" ON "chat_session_messages"("session_id", "turn_sequence", "turn_position");

