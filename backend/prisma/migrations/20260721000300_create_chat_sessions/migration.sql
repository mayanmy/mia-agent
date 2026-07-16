-- 保留型会话按 Agent 与成员唯一绑定；v1 不提供多窗口列表，后续可在此表上加 archived_at/title。
CREATE TYPE "chat_session_message_role" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "chat_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_sessions_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "chat_session_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "role" "chat_session_message_role" NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_session_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_session_messages_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_chat_sessions_agent_user" ON "chat_sessions"("agent_id", "user_id");
CREATE INDEX "idx_chat_sessions_user_updated_at" ON "chat_sessions"("user_id", "updated_at" DESC);
CREATE INDEX "idx_chat_session_messages_session_created_at"
  ON "chat_session_messages"("session_id", "created_at");
