-- 多向量维度第一步：知识库锁定维度，向量数据按维度进入不同物理表。
-- 现有数据历史上都写入 vector(1536)，因此迁移时默认标记为 1536 维。
ALTER TABLE "model_configs"
ADD COLUMN IF NOT EXISTS "embedding_dimension" INTEGER;

ALTER TABLE "knowledge_bases"
ADD COLUMN IF NOT EXISTS "embedding_dimension" INTEGER NOT NULL DEFAULT 1536;

CREATE INDEX IF NOT EXISTS "idx_knowledge_bases_embedding_dimension"
ON "knowledge_bases" ("embedding_dimension");

CREATE TABLE IF NOT EXISTS "knowledge_embeddings_1024" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "embedding_model_config_id" UUID NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_embeddings_1024_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_embeddings_1024_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_1024_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_1024_embedding_model_config_id_fkey" FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "knowledge_embeddings_1536" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "embedding_model_config_id" UUID NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_embeddings_1536_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_embeddings_1536_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_1536_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_1536_embedding_model_config_id_fkey" FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_knowledge_embeddings_1024_chunk_id"
ON "knowledge_embeddings_1024" ("chunk_id");

CREATE INDEX IF NOT EXISTS "idx_knowledge_embeddings_1024_kb_model"
ON "knowledge_embeddings_1024" ("knowledge_base_id", "embedding_model_config_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_knowledge_embeddings_1536_chunk_id"
ON "knowledge_embeddings_1536" ("chunk_id");

CREATE INDEX IF NOT EXISTS "idx_knowledge_embeddings_1536_kb_model"
ON "knowledge_embeddings_1536" ("knowledge_base_id", "embedding_model_config_id");

-- 兼容旧表：历史 knowledge_embeddings 是 1536 维，复制到新的 1536 分表。
INSERT INTO "knowledge_embeddings_1536" (
  "id",
  "knowledge_base_id",
  "chunk_id",
  "embedding_model_config_id",
  "embedding",
  "created_at"
)
SELECT
  "id",
  "knowledge_base_id",
  "chunk_id",
  "embedding_model_config_id",
  "embedding",
  "created_at"
FROM "knowledge_embeddings"
ON CONFLICT ("chunk_id") DO NOTHING;

