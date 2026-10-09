CREATE TYPE "model_thinking_mode" AS ENUM ('auto', 'enabled', 'disabled');

ALTER TABLE "model_configs"
ADD COLUMN "thinking_mode" "model_thinking_mode" NOT NULL DEFAULT 'auto';
