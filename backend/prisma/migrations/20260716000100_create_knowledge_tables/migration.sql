CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "knowledge_bases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "embedding_model_config_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_bases_embedding_model_config_id_fkey" FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "knowledge_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" BIGINT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "indexed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "knowledge_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "token_count" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_chunks_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "knowledge_embeddings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "chunk_id" UUID NOT NULL,
  "embedding_model_config_id" UUID NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "knowledge_embeddings_embedding_model_config_id_fkey" FOREIGN KEY ("embedding_model_config_id") REFERENCES "model_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "agent_knowledge_bases" (
  "agent_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_knowledge_bases_pkey" PRIMARY KEY ("agent_id", "knowledge_base_id"),
  CONSTRAINT "agent_knowledge_bases_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "agent_knowledge_bases_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_knowledge_bases_created_at" ON "knowledge_bases" ("created_at" DESC);
CREATE INDEX "idx_knowledge_bases_embedding_model_config_id" ON "knowledge_bases" ("embedding_model_config_id");
CREATE INDEX "idx_knowledge_bases_enabled_created_at" ON "knowledge_bases" ("enabled", "created_at" DESC);
CREATE UNIQUE INDEX "uq_knowledge_bases_name_active" ON "knowledge_bases" ("name") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_knowledge_documents_knowledge_base_id_created_at" ON "knowledge_documents" ("knowledge_base_id", "created_at" DESC);
CREATE INDEX "idx_knowledge_documents_knowledge_base_id_status_created_at" ON "knowledge_documents" ("knowledge_base_id", "status", "created_at" DESC);
CREATE INDEX "idx_knowledge_documents_file_hash" ON "knowledge_documents" ("file_hash");
CREATE INDEX "idx_knowledge_chunks_document_id_chunk_index" ON "knowledge_chunks" ("document_id", "chunk_index");
CREATE INDEX "idx_knowledge_chunks_knowledge_base_id_created_at" ON "knowledge_chunks" ("knowledge_base_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_knowledge_embeddings_chunk_id" ON "knowledge_embeddings" ("chunk_id");
CREATE INDEX "idx_knowledge_embeddings_kb_model" ON "knowledge_embeddings" ("knowledge_base_id", "embedding_model_config_id");
CREATE INDEX "idx_agent_knowledge_bases_knowledge_base_id" ON "agent_knowledge_bases" ("knowledge_base_id");
