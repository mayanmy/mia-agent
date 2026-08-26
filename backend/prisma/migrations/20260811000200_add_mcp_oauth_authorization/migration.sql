ALTER TYPE "mcp_auth_type" ADD VALUE IF NOT EXISTS 'OAUTH';

CREATE TABLE "mcp_oauth_authorizations" (
    "id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "encrypted_state" TEXT NOT NULL,
    "state_hash" TEXT,
    "state_expires_at" TIMESTAMPTZ(6),
    "authorized_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "mcp_oauth_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_mcp_oauth_authorizations_server_id"
ON "mcp_oauth_authorizations"("server_id");

CREATE UNIQUE INDEX "uq_mcp_oauth_authorizations_state_hash"
ON "mcp_oauth_authorizations"("state_hash");

CREATE INDEX "idx_mcp_oauth_authorizations_state_expires_at"
ON "mcp_oauth_authorizations"("state_expires_at");

ALTER TABLE "mcp_oauth_authorizations"
ADD CONSTRAINT "mcp_oauth_authorizations_server_id_fkey"
FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_authorizations"
ADD CONSTRAINT "mcp_oauth_authorizations_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
