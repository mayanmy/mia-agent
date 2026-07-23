CREATE TABLE "tool_secrets" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "encrypted_value" TEXT NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tool_secrets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tool_secrets_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "http_tools" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "method" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "parameters" JSONB NOT NULL,
  "fixed_headers" JSONB NOT NULL,
  "auth_type" TEXT NOT NULL DEFAULT 'none',
  "auth_header_name" TEXT,
  "secret_id" UUID,
  "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
  "max_response_bytes" INTEGER NOT NULL DEFAULT 1000000,
  "allow_private_network" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "http_tools_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "http_tools_secret_id_fkey"
    FOREIGN KEY ("secret_id") REFERENCES "tool_secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "http_tools_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_http_tools_slug" ON "http_tools"("slug");
CREATE UNIQUE INDEX "uq_http_tools_secret_id" ON "http_tools"("secret_id");
CREATE INDEX "idx_http_tools_enabled_deleted_at" ON "http_tools"("enabled", "deleted_at");
CREATE INDEX "idx_http_tools_created_at" ON "http_tools"("created_at" DESC);
CREATE INDEX "idx_tool_secrets_creator_created_at" ON "tool_secrets"("created_by_user_id", "created_at" DESC);
