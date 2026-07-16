-- 多会话改造：删除“一位成员只能有一条 Agent 会话”的旧唯一索引，保留所有已有会话数据。
DROP INDEX IF EXISTS "uq_chat_sessions_agent_user";

CREATE TYPE "chat_session_status" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "chat_sessions"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" "chat_session_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "summary_until_id" UUID,
  ADD COLUMN "last_message_at" TIMESTAMPTZ(6),
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

ALTER TABLE "chat_session_messages"
  ADD COLUMN "metadata" JSONB;

-- 旧会话迁移后仍可正常排序，最近消息时间从历史消息中回填。
UPDATE "chat_sessions"
SET "last_message_at" = latest."created_at"
FROM (
  SELECT "session_id", MAX("created_at") AS "created_at"
  FROM "chat_session_messages"
  GROUP BY "session_id"
) AS latest
WHERE latest."session_id" = "chat_sessions"."id";

DROP INDEX IF EXISTS "idx_users_chat_sessions_updated_at";
DROP INDEX IF EXISTS "idx_chat_sessions_user_updated_at";
DROP INDEX IF EXISTS "idx_chat_session_messages_session_created_at";

CREATE INDEX "idx_chat_sessions_agent_user_status_last_message"
  ON "chat_sessions" ("agent_id", "user_id", "status", "last_message_at" DESC);
CREATE INDEX "idx_chat_sessions_user_status_updated_at"
  ON "chat_sessions" ("user_id", "status", "updated_at" DESC);
CREATE INDEX "idx_chat_session_messages_cursor"
  ON "chat_session_messages" ("session_id", "created_at" DESC, "id" DESC);
