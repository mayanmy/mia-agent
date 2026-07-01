-- 为后续 Qdrant Collection-per-KnowledgeBase 预留知识库级向量命名空间。
-- 当前仍使用 PGVECTOR 实现，collection_name 先按 kb_{knowledge_base_id} 生成，保证业务层已经按知识库隔离建模。
ALTER TABLE "knowledge_bases"
ADD COLUMN "vector_store_type" TEXT NOT NULL DEFAULT 'PGVECTOR',
ADD COLUMN "vector_collection_name" TEXT;

UPDATE "knowledge_bases"
SET "vector_collection_name" = 'kb_' || "id"::text
WHERE "vector_collection_name" IS NULL;

ALTER TABLE "knowledge_bases"
ALTER COLUMN "vector_collection_name" SET NOT NULL;

CREATE UNIQUE INDEX "uq_knowledge_bases_vector_collection_name"
ON "knowledge_bases" ("vector_collection_name");

