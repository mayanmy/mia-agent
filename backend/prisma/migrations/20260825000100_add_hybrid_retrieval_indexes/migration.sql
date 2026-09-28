-- 混合检索的关键词通道：FTS 覆盖英文/路径/错误码，pg_trgm 覆盖中文连续文本和模糊匹配。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "idx_knowledge_chunks_content_fts"
  ON "knowledge_chunks"
  USING GIN (to_tsvector('simple', "content"))
  WHERE "deleted_at" IS NULL;

CREATE INDEX "idx_knowledge_chunks_content_trgm"
  ON "knowledge_chunks"
  USING GIN (lower("content") gin_trgm_ops)
  WHERE "deleted_at" IS NULL;

-- 先按项目空间和授权知识库收窄候选，避免多空间数据量增长后扫描无关 Chunk。
CREATE INDEX "idx_knowledge_chunks_workspace_kb_active"
  ON "knowledge_chunks" ("workspace_id", "knowledge_base_id")
  WHERE "deleted_at" IS NULL;
