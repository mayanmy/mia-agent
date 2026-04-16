-- CreateEnum
CREATE TYPE "model_provider_type" AS ENUM ('openai_compatible', 'ollama', 'anthropic', 'gemini');

-- CreateEnum
CREATE TYPE "model_config_type" AS ENUM ('chat', 'embedding');

-- CreateTable
CREATE TABLE "model_providers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" "model_provider_type" NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_type" "model_config_type" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 120,
    "max_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "system_prompt" TEXT NOT NULL,
    "model_config_id" UUID NOT NULL,
    "temperature" DECIMAL(3,2) NOT NULL DEFAULT 0.70,
    "max_tokens" INTEGER,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 120,
    "history_turns" INTEGER NOT NULL DEFAULT 6,
    "generation_params" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "agent_id" UUID NOT NULL,
    "tool_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("agent_id","tool_id")
);

-- CreateIndex
CREATE INDEX "idx_model_providers_created_at" ON "model_providers"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_model_providers_enabled_created_at" ON "model_providers"("enabled", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_model_configs_provider_id" ON "model_configs"("provider_id");

-- CreateIndex
CREATE INDEX "idx_model_configs_type_enabled" ON "model_configs"("model_type", "enabled");

-- CreateIndex
CREATE INDEX "idx_model_configs_created_at" ON "model_configs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_agents_created_at" ON "agents"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_agents_model_config_id" ON "agents"("model_config_id");

-- CreateIndex
CREATE INDEX "idx_agents_enabled_created_at" ON "agents"("enabled", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_agent_tools_tool_id" ON "agent_tools"("tool_id");

-- AddForeignKey
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
