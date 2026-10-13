CREATE TYPE "model_capability_type" AS ENUM (
  'TEXT_CHAT', 'VISION_INPUT', 'TOOL_CALLING', 'REASONING', 'STRUCTURED_OUTPUT',
  'AUDIO_INPUT', 'AUDIO_OUTPUT', 'IMAGE_GENERATION', 'EMBEDDING', 'RERANK'
);

CREATE TYPE "agent_vision_mode" AS ENUM ('AUTO', 'PRIMARY_ONLY', 'DEDICATED', 'DISABLED');

ALTER TYPE "agent_run_step_type" ADD VALUE 'ROUTER' BEFORE 'TOOL_SEARCH';

CREATE TABLE "model_capabilities" (
  "id" UUID NOT NULL,
  "model_config_id" UUID NOT NULL,
  "capability" "model_capability_type" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "options" JSONB,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "model_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "model_capabilities_model_config_id_capability_key"
  ON "model_capabilities"("model_config_id", "capability");
CREATE INDEX "model_capabilities_capability_enabled_idx"
  ON "model_capabilities"("capability", "enabled");
ALTER TABLE "model_capabilities" ADD CONSTRAINT "model_capabilities_model_config_id_fkey"
  FOREIGN KEY ("model_config_id") REFERENCES "model_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "default_model_settings" ADD COLUMN "vision_model_config_id" UUID;
CREATE INDEX "idx_default_model_settings_vision_model_config_id"
  ON "default_model_settings"("vision_model_config_id");
ALTER TABLE "default_model_settings" ADD CONSTRAINT "default_model_settings_vision_model_config_id_fkey"
  FOREIGN KEY ("vision_model_config_id") REFERENCES "model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agents"
  ADD COLUMN "vision_mode" "agent_vision_mode" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "vision_model_config_id" UUID;
CREATE INDEX "idx_agents_vision_model_config_id" ON "agents"("vision_model_config_id");
ALTER TABLE "agents" ADD CONSTRAINT "agents_vision_model_config_id_fkey"
  FOREIGN KEY ("vision_model_config_id") REFERENCES "model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "model_capabilities" (
  "id", "model_config_id", "capability", "enabled", "verified", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "id", 'TEXT_CHAT', true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "model_configs"
WHERE "model_type" = 'chat' AND "deleted_at" IS NULL;
