-- “平台管理员”只管理账号；空间内委派角色改称 MANAGER，消除两类 ADMIN 的语义冲突。
ALTER TYPE "workspace_role" RENAME VALUE 'ADMIN' TO 'MANAGER';

-- Agent 必须记录创建者，普通成员才能安全地只管理自己的资源。
ALTER TABLE "agents" ADD COLUMN "created_by_user_id" UUID;

-- 单空间历史数据没有创建者审计，统一归属到空间创建者；不删除或跳过任何 Agent。
UPDATE "agents" AS agent
SET "created_by_user_id" = workspace."created_by_id"
FROM "workspaces" AS workspace
WHERE workspace."id" = agent."workspace_id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "agents" WHERE "created_by_user_id" IS NULL) THEN
    RAISE EXCEPTION 'cannot backfill agents.created_by_user_id because workspace creator is missing';
  END IF;
END $$;

ALTER TABLE "agents" ALTER COLUMN "created_by_user_id" SET NOT NULL;
ALTER TABLE "agents"
  ADD CONSTRAINT "agents_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_agents_workspace_creator_deleted_created"
  ON "agents"("workspace_id", "created_by_user_id", "deleted_at", "created_at" DESC);

CREATE INDEX "idx_http_tools_workspace_creator_deleted_created"
  ON "http_tools"("workspace_id", "created_by_user_id", "deleted_at", "created_at" DESC);
