CREATE TABLE "default_model_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "chat_model_config_id" UUID,
    "embedding_model_config_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "default_model_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_default_model_settings_chat_model_config_id"
ON "default_model_settings"("chat_model_config_id");

CREATE INDEX "idx_default_model_settings_embedding_model_config_id"
ON "default_model_settings"("embedding_model_config_id");

ALTER TABLE "default_model_settings"
ADD CONSTRAINT "default_model_settings_chat_model_config_id_fkey"
FOREIGN KEY ("chat_model_config_id") REFERENCES "model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "default_model_settings"
ADD CONSTRAINT "default_model_settings_embedding_model_config_id_fkey"
FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
