-- 项目空间是共享数据库内的一级租户边界；角色从全局 User 迁移到成员关系。
CREATE TYPE "workspace_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspaces_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "idx_workspaces_deleted_created_at"
  ON "workspaces"("deleted_at", "created_at" DESC);
CREATE INDEX "idx_workspaces_created_by_id" ON "workspaces"("created_by_id");

CREATE TABLE "workspace_members" (
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "workspace_role" NOT NULL DEFAULT 'MEMBER',
  "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id"),
  CONSTRAINT "workspace_members_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_workspace_members_user_removed_at"
  ON "workspace_members"("user_id", "removed_at");
CREATE INDEX "idx_workspace_members_workspace_role_removed_at"
  ON "workspace_members"("workspace_id", "role", "removed_at");

-- 有现存用户时创建唯一默认空间；最早的有效 ADMIN 优先成为 OWNER，否则使用最早用户。
WITH owner_candidate AS (
  SELECT "id"
  FROM "users"
  ORDER BY
    CASE WHEN "role" = 'ADMIN' AND "disabled_at" IS NULL THEN 0 ELSE 1 END,
    "created_at" ASC,
    "id" ASC
  LIMIT 1
)
INSERT INTO "workspaces" ("name", "description", "created_by_id")
SELECT '默认项目空间', '由单空间版本迁移生成', "id"
FROM owner_candidate;

-- 当前全部账号加入默认空间：空间创建者为 OWNER，其余旧 ADMIN 为 ADMIN，旧 USER 为 MEMBER。
INSERT INTO "workspace_members" ("workspace_id", "user_id", "role")
SELECT
  workspace."id",
  users."id",
  CASE
    WHEN users."id" = workspace."created_by_id" THEN 'OWNER'::"workspace_role"
    WHEN users."role" = 'ADMIN' THEN 'ADMIN'::"workspace_role"
    ELSE 'MEMBER'::"workspace_role"
  END
FROM "users" users
CROSS JOIN LATERAL (
  SELECT "id", "created_by_id"
  FROM "workspaces"
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
) workspace;

-- 旧邀请全部归入默认空间，并把全局角色映射为空间角色。
ALTER TABLE "user_invitations" ADD COLUMN "workspace_id" UUID;
ALTER TABLE "user_invitations" RENAME COLUMN "role" TO "legacy_role";
ALTER TABLE "user_invitations"
  ADD COLUMN "role" "workspace_role" NOT NULL DEFAULT 'MEMBER';

UPDATE "user_invitations"
SET
  "workspace_id" = (SELECT "id" FROM "workspaces" ORDER BY "created_at" ASC, "id" ASC LIMIT 1),
  "role" = CASE
    WHEN "legacy_role" = 'ADMIN' THEN 'ADMIN'::"workspace_role"
    ELSE 'MEMBER'::"workspace_role"
  END;

ALTER TABLE "user_invitations" DROP CONSTRAINT IF EXISTS "uq_user_invitations_email";
DROP INDEX IF EXISTS "uq_user_invitations_email";
ALTER TABLE "user_invitations" DROP COLUMN "legacy_role";
ALTER TABLE "user_invitations" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "user_invitations"
  ADD CONSTRAINT "user_invitations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_invitations"
  ADD CONSTRAINT "uq_user_invitations_workspace_email" UNIQUE ("workspace_id", "email");

CREATE INDEX "idx_user_invitations_workspace_created_at"
  ON "user_invitations"("workspace_id", "created_at" DESC);
