-- 发布治理配置属于 Agent 本身：公开开关继续复用 published，额外补齐过期、来源域名和密码保护。
ALTER TABLE "agents"
  ADD COLUMN "public_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_allowed_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "public_password_hash" TEXT;

CREATE INDEX "idx_agents_public_expires_at" ON "agents"("public_expires_at");
