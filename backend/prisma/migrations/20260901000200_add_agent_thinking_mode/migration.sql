ALTER TABLE "model_configs"
ADD COLUMN "thinking_supported" BOOLEAN NOT NULL DEFAULT false;

-- 已经显式配置开启/关闭的模型视为支持可选思考，兼容现有配置。
UPDATE "model_configs"
SET "thinking_supported" = true
WHERE "thinking_mode" <> 'auto';

ALTER TABLE "agents"
ADD COLUMN "thinking_mode" "model_thinking_mode" NOT NULL DEFAULT 'auto';
