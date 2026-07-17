-- 外部访问数据与工作台用户会话分表保存，避免公开 Widget 访客进入 users/chat_sessions 体系。
CREATE TYPE "external_user_source" AS ENUM ('WIDGET', 'WEBAPP', 'SERVICE_API');

CREATE TABLE "agent_api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "last_used_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_api_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_agent_api_keys_key_hash" UNIQUE ("key_hash"),
  CONSTRAINT "agent_api_keys_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "external_end_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "source" "external_user_source" NOT NULL,
  "external_id" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_end_users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_external_end_users_agent_source_external" UNIQUE ("agent_id", "source", "external_id"),
  CONSTRAINT "external_end_users_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "external_conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "external_end_user_id" UUID NOT NULL,
  "title" TEXT,
  "source" "external_user_source" NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "external_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_conversations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "external_conversations_external_end_user_id_fkey" FOREIGN KEY ("external_end_user_id") REFERENCES "external_end_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "external_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "external_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "external_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_agent_api_keys_agent_id_created_at" ON "agent_api_keys"("agent_id", "created_at" DESC);
CREATE INDEX "idx_agent_api_keys_expires_at" ON "agent_api_keys"("expires_at");
CREATE INDEX "idx_external_end_users_agent_last_seen_at" ON "external_end_users"("agent_id", "last_seen_at" DESC);
CREATE INDEX "idx_external_conversations_end_user_updated_at" ON "external_conversations"("external_end_user_id", "updated_at" DESC);
CREATE INDEX "idx_external_conversations_agent_created_at" ON "external_conversations"("agent_id", "created_at" DESC);
CREATE INDEX "idx_external_messages_conversation_created_at" ON "external_messages"("conversation_id", "created_at", "id");
