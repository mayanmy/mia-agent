-- 管理员邀请成员后先保存一次性链接元数据；账号在成员接受邀请时才创建。
CREATE TABLE "user_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "role" "user_role" NOT NULL DEFAULT 'USER',
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "invited_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_invitations_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_user_invitations_email" ON "user_invitations"("email");
CREATE UNIQUE INDEX "uq_user_invitations_token_hash" ON "user_invitations"("token_hash");
CREATE INDEX "idx_user_invitations_expires_at" ON "user_invitations"("expires_at");
CREATE INDEX "idx_user_invitations_invited_by_created_at"
  ON "user_invitations"("invited_by_user_id", "created_at" DESC);
