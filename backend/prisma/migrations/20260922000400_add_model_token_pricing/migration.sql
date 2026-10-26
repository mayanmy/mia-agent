ALTER TABLE "model_configs"
  ADD COLUMN "input_token_price_per_million" DECIMAL(14, 6),
  ADD COLUMN "output_token_price_per_million" DECIMAL(14, 6),
  ADD COLUMN "price_currency" TEXT NOT NULL DEFAULT 'CNY';
