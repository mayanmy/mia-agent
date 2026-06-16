# 知识库模块技术开发文档

## 1. 模块目标

知识库模块负责知识资产生命周期管理：知识库、文档、解析文本、chunks 和处理状态。它为 Retrieval 模块提供可向量化的数据，为 Chat 模块提供可引用的知识来源。

后端模块路径：

```text
backend/src/modules/knowledge/
backend/src/modules/retrieval/
backend/src/jobs/
```

前端模块路径：

```text
frontend/src/features/knowledge/
```

## 2. 模块边界

### 2.1 knowledge 模块

负责：

- `knowledge_bases` CRUD。
- `knowledge_documents` CRUD。
- 文档上传元数据。
- 文档解析。
- 文档切分。
- `knowledge_chunks` 管理。
- 文档处理状态。
- 重建索引入口。

不负责：

- 不生成 embedding。
- 不执行向量检索。
- 不拼 RAG Prompt。
- 不执行 Chat。

### 2.2 retrieval 模块

负责：

- 调用 Embedding 模型。
- 写入 `knowledge_embeddings`。
- 向量检索。
- 构造 `RetrievalContext`。
- 检索测试。

不负责：

- 不管理知识库 CRUD。
- 不解析文件。
- 不保存 Agent 绑定关系。

### 2.3 agents 模块

负责：

- Agent 绑定知识库。
- 校验绑定的 knowledgeBaseIds 是否存在。
- 输出 AgentRuntimeConfig.knowledgeBaseIds。

### 2.4 chat 模块

负责：

- 根据 AgentRuntimeConfig 调用 retrieval。
- 将检索结果注入模型上下文。
- SSE 发送 `retrieval_start` / `retrieval_result`。
- 将引用来源写入消息或日志。

## 3. 后端目录结构

```text
backend/src/modules/knowledge/
  knowledge.module.ts
  knowledge.controller.ts
  knowledge.service.ts
  dto/
    knowledge.dto.ts
  parsing.ts
  chunking.ts

backend/src/modules/retrieval/
  retrieval.module.ts
  retrieval.service.ts
  dto/
    retrieval.dto.ts
  embedding.ts
  vector-store.ts

backend/src/jobs/
  document-indexing.job.ts
```

## 4. 数据表设计

### 4.1 knowledge_bases

用途：知识库主表。

```sql
CREATE TABLE knowledge_bases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  embedding_model_config_id uuid NOT NULL REFERENCES model_configs(id),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

索引：

```sql
CREATE INDEX idx_knowledge_bases_created_by_created_at
ON knowledge_bases (created_by, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_knowledge_bases_embedding_model_config_id
ON knowledge_bases (embedding_model_config_id);

CREATE UNIQUE INDEX uq_knowledge_bases_name_created_by
ON knowledge_bases (created_by, name)
WHERE deleted_at IS NULL;
```

### 4.2 knowledge_documents

用途：知识库文档元数据和处理状态。

```sql
CREATE TABLE knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  filename text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  file_hash text NOT NULL,
  storage_path text NOT NULL,
  status text NOT NULL,
  error_message text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

索引：

```sql
CREATE INDEX idx_knowledge_documents_knowledge_base_id_created_at
ON knowledge_documents (knowledge_base_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_knowledge_documents_knowledge_base_id_status_created_at
ON knowledge_documents (knowledge_base_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_knowledge_documents_file_hash
ON knowledge_documents (file_hash);
```

### 4.3 knowledge_chunks

用途：文档解析切分后的文本片段。

```sql
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  document_id uuid NOT NULL REFERENCES knowledge_documents(id),
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_count integer,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

索引：

```sql
CREATE INDEX idx_knowledge_chunks_document_id_chunk_index
ON knowledge_chunks (document_id, chunk_index)
WHERE deleted_at IS NULL;

CREATE INDEX idx_knowledge_chunks_knowledge_base_id_created_at
ON knowledge_chunks (knowledge_base_id, created_at DESC)
WHERE deleted_at IS NULL;
```

### 4.4 knowledge_embeddings

用途：chunk 对应的向量数据，归 retrieval 模块写入。

```sql
CREATE TABLE knowledge_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id uuid NOT NULL,
  chunk_id uuid NOT NULL REFERENCES knowledge_chunks(id),
  embedding_model_config_id uuid NOT NULL REFERENCES model_configs(id),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

索引：

```sql
CREATE INDEX idx_knowledge_embeddings_chunk_id
ON knowledge_embeddings (chunk_id);

CREATE INDEX idx_knowledge_embeddings_kb_model
ON knowledge_embeddings (knowledge_base_id, embedding_model_config_id);
```

向量索引 v1 可以先不做近似索引，v1.1 或数据量超过 50k chunks 后增加 HNSW。

### 4.5 agent_knowledge_bases

归属：`agents` 模块。

```sql
CREATE TABLE agent_knowledge_bases (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, knowledge_base_id)
);

CREATE INDEX idx_agent_knowledge_bases_knowledge_base_id
ON agent_knowledge_bases (knowledge_base_id);
```

## 5. Prisma Model 建议

```prisma
model KnowledgeBase {
  id                     String              @id @default(uuid()) @db.Uuid
  name                   String
  description            String              @default("")
  embeddingModelConfigId String              @map("embedding_model_config_id") @db.Uuid
  enabled                Boolean             @default(true)
  createdBy              String?             @map("created_by") @db.Uuid
  updatedBy              String?             @map("updated_by") @db.Uuid
  createdAt              DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt              DateTime?           @map("deleted_at") @db.Timestamptz(6)
  documents              KnowledgeDocument[]
  chunks                 KnowledgeChunk[]

  @@index([createdBy, createdAt(sort: Desc)], map: "idx_knowledge_bases_created_by_created_at")
  @@index([embeddingModelConfigId], map: "idx_knowledge_bases_embedding_model_config_id")
  @@map("knowledge_bases")
}
```

部分唯一索引需要在 migration SQL 中手写。

## 6. DTO 设计

### 6.1 KnowledgeBaseCreateDto

```typescript
export type KnowledgeBaseCreateDto = {
  name?: string;
  description?: string;
  embeddingModelConfigId?: string;
  enabled?: boolean;
};
```

### 6.2 KnowledgeBaseUpdateDto

```typescript
export type KnowledgeBaseUpdateDto = Partial<KnowledgeBaseCreateDto>;
```

### 6.3 KnowledgeBaseListItem

```typescript
export type KnowledgeBaseListItem = {
  id: string;
  name: string;
  description: string;
  embeddingModelConfigId: string;
  embeddingModelName: string;
  documentCount: number;
  chunkCount: number;
  failedDocumentCount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};
```

### 6.4 KnowledgeDocumentListItem

```typescript
export type KnowledgeDocumentListItem = {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### 6.5 KnowledgeChunkListItem

```typescript
export type KnowledgeChunkListItem = {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  metadata: Record<string, unknown> | null;
};
```

## 7. API 设计

### 7.1 知识库 API

```text
GET    /api/v1/knowledge-bases
POST   /api/v1/knowledge-bases
GET    /api/v1/knowledge-bases/:id
PUT    /api/v1/knowledge-bases/:id
DELETE /api/v1/knowledge-bases/:id
```

### 7.2 文档 API

```text
GET    /api/v1/knowledge-bases/:id/documents
POST   /api/v1/knowledge-bases/:id/documents
GET    /api/v1/knowledge-documents/:documentId
DELETE /api/v1/knowledge-documents/:documentId
POST   /api/v1/knowledge-documents/:documentId/reindex
GET    /api/v1/knowledge-documents/:documentId/chunks
```

### 7.3 检索测试 API

归 `retrieval` 模块，v1.1 实现。

```text
POST /api/v1/retrieval/test
```

请求：

```typescript
export type RetrievalTestDto = {
  knowledgeBaseIds: string[];
  query: string;
  topK?: number;
  scoreThreshold?: number;
};
```

## 8. 文档处理流程

### 8.1 v1 同步或轻量异步流程

```text
上传文件
  -> knowledge.service 创建 document(status=pending)
  -> 保存原文件到本地 storage
  -> document-indexing.job 开始处理
  -> parsing.ts 提取文本
  -> chunking.ts 切分 chunks
  -> knowledge.service 写 chunks
  -> retrieval.service 生成 embeddings
  -> document.status=indexed
```

### 8.2 状态更新

```text
pending
  -> parsing
  -> chunking
  -> embedding
  -> indexed
```

失败时：

```text
failed + error_message
```

## 9. 解析与切分

### 9.1 v1 支持格式

- `text/plain`
- `text/markdown`
- `.txt`
- `.md`

### 9.2 v1.1 支持格式

- PDF
- DOCX

### 9.3 默认切分策略

v1 固定策略：

```text
chunk_size: 800-1000 tokens
chunk_overlap: 100-150 tokens
```

如果 v1 暂时没有 tokenizer，可以按字符近似：

```text
chunk_size: 2000 chars
chunk_overlap: 200 chars
```

v2 再改为可配置 tokenizer-aware chunking。

## 10. Retrieval 设计

### 10.1 Embedding

Retrieval 模块调用：

```text
model_providers.service.create_embedding
```

写入：

```text
knowledge_embeddings
```

### 10.2 检索

Chat 调用：

```text
retrieval.service.retrieveContext({
  knowledgeBaseIds,
  query,
  topK,
  scoreThreshold
})
```

返回：

```typescript
export type RetrievalContext = {
  query: string;
  chunks: RetrievalChunk[];
  sources: RetrievalSource[];
  elapsedMs: number;
};
```

### 10.3 检索约束

- 必须按 `knowledge_base_id` 过滤。
- 只能检索 Agent 绑定的知识库。
- 已删除文档和 chunk 不可被检索。
- 低于阈值的结果不注入 Prompt。

## 11. 前端结构

```text
frontend/src/features/knowledge/
  KnowledgePage.tsx
  api.ts
  types.ts
  knowledge.less
  components/
    KnowledgeBaseTable.tsx
    KnowledgeBaseFormModal.tsx
    KnowledgeDocumentTable.tsx
    DocumentUploadModal.tsx
    DocumentDetailDrawer.tsx
    ChunkPreviewList.tsx
    RetrievalTestPanel.tsx
  utils/
    file-size.ts
    status.ts
```

v1 页面：

- 知识库列表。
- 创建 / 编辑知识库弹窗。
- 文档列表。
- 上传文档。
- 删除文档。
- 重建索引。

v1.1 页面：

- 文档详情抽屉。
- chunk 预览。
- 检索测试。

## 12. 后台任务设计

### 12.1 document-indexing.job

职责：

- 串联 parsing、chunking、embedding。
- 更新文档状态。
- 写入失败原因。
- 保证单文档失败不影响其他文档。

### 12.2 并发限制

推荐 v1 初始值：

```text
document_parse_concurrency: 2
embedding_concurrency: 3
```

### 12.3 幂等

重建索引必须先处理旧数据：

```text
soft delete old chunks
delete old embeddings
write new chunks
write new embeddings
```

如果中途失败：

- document 状态为 `failed`。
- 不应留下部分可检索的新旧混合数据。

## 13. 日志与排查

文档处理日志至少记录：

```text
request_id
knowledge_base_id
document_id
job_type
status
stage
elapsed_ms
error_type
error_message
created_at
```

Chat RAG 日志至少记录：

```text
request_id
agent_id
knowledge_base_ids
query
top_k
hit_count
elapsed_ms
chunk_ids
scores
```

## 14. 开发版本拆分

### 14.1 v1 开发任务

后端：

- 新增 `knowledge_bases`。
- 新增 `knowledge_documents`。
- 新增 `knowledge_chunks`。
- 新增 `knowledge_embeddings`。
- 新增 `agent_knowledge_bases`。
- 实现知识库 CRUD。
- 实现文档上传。
- 实现 TXT / Markdown 解析。
- 实现基础 chunking。
- 实现文档状态流转。
- 实现文档删除。
- 实现文档重建索引。
- Retrieval 生成 embedding。
- Chat 接入 retrieval。
- Agent 绑定知识库。

前端：

- 知识库列表页。
- 知识库创建 / 编辑弹窗。
- 文档列表。
- 文档上传。
- 文档状态展示。
- 文档删除 / 重建索引操作。
- Agent 表单增加知识库绑定 Tab。

测试：

- 创建知识库成功。
- Embedding 模型校验失败。
- 上传 TXT / MD 成功。
- 文档解析失败可读。
- 删除文档后不可检索。
- Agent 绑定非法知识库失败。
- Chat RAG 主路径成功。

### 14.2 v1.1 开发任务

后端：

- 支持 PDF / DOCX 解析。
- 文件 hash 去重。
- 文档详情。
- chunk 预览接口。
- 检索测试接口。
- 文档删除同步清理 embeddings。
- 处理进度字段。

前端：

- 文档详情抽屉。
- chunk 预览。
- 检索测试面板。
- 文档状态筛选。
- 失败重试。

测试：

- PDF 解析成功。
- DOCX 解析成功。
- 重复文件提示。
- 检索测试返回 chunks 和 score。
- 失败文档重试成功。

### 14.3 v1.2 开发任务

后端：

- 批量上传。
- 批量删除。
- 批量重建索引。
- 知识库统计字段或聚合查询。
- 后台任务列表。
- 失败文档聚合。

前端：

- 批量操作。
- 知识库统计卡片。
- 任务进度展示。
- 文档搜索。
- 文档类型筛选。

测试：

- 批量上传部分失败不影响成功文件。
- 批量重建索引状态正确。
- 统计数据准确。

### 14.4 v2 开发任务

后端：

- chunk size / overlap 配置。
- BM25 检索。
- 混合检索融合。
- rerank。
- 查询改写。
- Agent 级检索参数覆盖。

前端：

- 检索参数配置。
- 检索测试展示 score、rerank score。
- 来源高亮。

测试：

- chunk 参数生效。
- 混合检索返回结果。
- rerank 后排序变化可验证。

### 14.5 v2.1 开发任务

后端：

- 知识库权限模型。
- 知识库所有者。
- 上传权限。
- Agent 绑定权限校验。
- 操作审计。

前端：

- 权限配置入口。
- 操作审计展示。

### 14.6 v3 开发任务

后端：

- 文档版本。
- 增量更新。
- 网页导入。
- 定时同步。
- 外部对象存储。
- 多 embedding namespace。

前端：

- 版本历史。
- 导入导出。
- 同步任务配置。

## 15. 验证命令

本仓库默认使用 Node 22。

```bash
npm run check
npm --prefix backend run test
npm run build
```

涉及 Prisma：

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate
```
