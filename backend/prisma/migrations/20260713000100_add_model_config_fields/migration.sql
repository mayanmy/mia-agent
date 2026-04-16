ALTER TABLE "model_configs"
ADD COLUMN "credential_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "context_length" INTEGER NOT NULL DEFAULT 4096;
