-- Auth/User v1：用户资料归 users 模块，会话归 auth 模块。
-- Refresh Token 只保存不可逆哈希，数据库泄漏时不能直接复用用户会话。
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'USER');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "user_role" NOT NULL DEFAULT 'USER',
  "last_login_at" TIMESTAMPTZ(6),
  "disabled_at" TIMESTAMPTZ(6),
  "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_users_email" ON "users"("email");
CREATE UNIQUE INDEX "uq_auth_sessions_refresh_token_hash" ON "auth_sessions"("refresh_token_hash");
CREATE INDEX "idx_users_role_disabled_at" ON "users"("role", "disabled_at");
CREATE INDEX "idx_users_created_at" ON "users"("created_at" DESC);
CREATE INDEX "idx_auth_sessions_user_id_expires_at" ON "auth_sessions"("user_id", "expires_at" DESC);
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions"("expires_at");
