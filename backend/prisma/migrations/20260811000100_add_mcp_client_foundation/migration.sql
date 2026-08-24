-- MCP Client 首期只开放 Streamable HTTP，枚举仍保留清晰的协议和治理边界。
CREATE TYPE "mcp_transport" AS ENUM ('STREAMABLE_HTTP');
CREATE TYPE "mcp_auth_type" AS ENUM ('NONE', 'BEARER', 'API_KEY_HEADER', 'CLIENT_CREDENTIALS');
CREATE TYPE "mcp_approval_mode" AS ENUM ('AUTO', 'CONFIRM', 'DISABLED');
CREATE TYPE "mcp_health_status" AS ENUM ('UNKNOWN', 'CONNECTING', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'AUTH_REQUIRED');
CREATE TYPE "mcp_risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "mcp_sync_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "mcp_sync_trigger" AS ENUM ('CREATE', 'MANUAL', 'TEST', 'NOTIFICATION', 'SCHEDULED');

CREATE TABLE "mcp_server_secrets" (
  "id" UUID NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mcp_server_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_servers" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "transport" "mcp_transport" NOT NULL DEFAULT 'STREAMABLE_HTTP',
  "endpoint" TEXT NOT NULL,
  "auth_type" "mcp_auth_type" NOT NULL DEFAULT 'NONE',
  "auth_config" JSONB NOT NULL DEFAULT '{}',
  "secret_id" UUID,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "allow_private_network" BOOLEAN NOT NULL DEFAULT false,
  "approval_mode" "mcp_approval_mode" NOT NULL DEFAULT 'AUTO',
  "connect_timeout_ms" INTEGER NOT NULL DEFAULT 10000,
  "tool_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  "max_response_bytes" INTEGER NOT NULL DEFAULT 1000000,
  "max_output_chars" INTEGER NOT NULL DEFAULT 20000,
  "max_concurrency" INTEGER NOT NULL DEFAULT 3,
  "health_status" "mcp_health_status" NOT NULL DEFAULT 'UNKNOWN',
  "negotiated_protocol_version" TEXT,
  "server_info" JSONB,
  "capabilities" JSONB,
  "last_connected_at" TIMESTAMPTZ(6),
  "last_discovered_at" TIMESTAMPTZ(6),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_server_tools" (
  "id" UUID NOT NULL,
  "server_id" UUID NOT NULL,
  "remote_name" TEXT NOT NULL,
  "runtime_id" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  "input_schema" JSONB NOT NULL,
  "output_schema" JSONB,
  "annotations" JSONB,
  "schema_hash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "approval_mode" "mcp_approval_mode",
  "risk_level" "mcp_risk_level" NOT NULL DEFAULT 'LOW',
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "unavailable_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mcp_server_tools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_sync_runs" (
  "id" UUID NOT NULL,
  "server_id" UUID NOT NULL,
  "status" "mcp_sync_status" NOT NULL DEFAULT 'RUNNING',
  "trigger" "mcp_sync_trigger" NOT NULL,
  "tool_count" INTEGER NOT NULL DEFAULT 0,
  "schema_changed_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "elapsed_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "mcp_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_mcp_servers_slug" ON "mcp_servers"("slug");
CREATE UNIQUE INDEX "uq_mcp_servers_secret_id" ON "mcp_servers"("secret_id");
CREATE INDEX "idx_mcp_servers_enabled_deleted_at" ON "mcp_servers"("enabled", "deleted_at");
CREATE INDEX "idx_mcp_servers_health_updated_at" ON "mcp_servers"("health_status", "updated_at" DESC);
CREATE INDEX "idx_mcp_server_secrets_creator_created_at" ON "mcp_server_secrets"("created_by_user_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_mcp_server_tools_runtime_id" ON "mcp_server_tools"("runtime_id");
CREATE UNIQUE INDEX "uq_mcp_server_tools_server_remote_name" ON "mcp_server_tools"("server_id", "remote_name");
CREATE INDEX "idx_mcp_server_tools_server_enabled_available" ON "mcp_server_tools"("server_id", "enabled", "unavailable_at");
CREATE INDEX "idx_mcp_sync_runs_server_created_at" ON "mcp_sync_runs"("server_id", "created_at" DESC);

ALTER TABLE "mcp_server_secrets" ADD CONSTRAINT "mcp_server_secrets_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_secret_id_fkey"
  FOREIGN KEY ("secret_id") REFERENCES "mcp_server_secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mcp_server_tools" ADD CONSTRAINT "mcp_server_tools_server_id_fkey"
  FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_sync_runs" ADD CONSTRAINT "mcp_sync_runs_server_id_fkey"
  FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
