-- 补齐 3072 维分表，覆盖 text-embedding-3-large 等常见高维 Embedding 模型。
CREATE TABLE IF NOT EXISTS "knowledge_embeddings_3072" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "embedding_model_config_id" UUID NOT NULL,
  "embedding" vector(3072) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_embeddings_3072_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_embeddings_3072_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_3072_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_3072_embedding_model_config_id_fkey" FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_knowledge_embeddings_3072_chunk_id"
ON "knowledge_embeddings_3072" ("chunk_id");

CREATE INDEX IF NOT EXISTS "idx_knowledge_embeddings_3072_kb_model"
ON "knowledge_embeddings_3072" ("knowledge_base_id", "embedding_model_config_id");

