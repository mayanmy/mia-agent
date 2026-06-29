# 知识库多向量维度技术文档

## 1. 技术目标

支持不同知识库使用不同 Embedding 模型和向量维度，同时保证同一个知识库内向量维度一致。

当前实现使用单表固定维度：

```sql
knowledge_embeddings.embedding vector(1536)
```

目标实现改为：

- 知识库记录自己的 `embedding_model_config_id` 和 `embedding_dimension`。
- 向量数据按维度进入不同物理表。
- 检索按 `embedding_model_config_id` 分组生成 query embedding。
- 同一组只查询相同 Embedding 模型构建的知识库。

## 2. 设计原则

- 同一个知识库只允许一个 Embedding 模型。
- 同一个知识库只允许一个向量维度。
- 不同知识库允许不同维度。
- 检索分组优先按 `embedding_model_config_id`，不是只按维度。
- 入库前校验维度，避免 pgvector 抛底层错误。
- v1 先支持有限维度，避免做成开放式动态 DDL。

## 3. 推荐方案

### 3.1 按维度分表

推荐使用按维度分表：

```text
knowledge_embeddings_1024
knowledge_embeddings_1536
knowledge_embeddings_3072
```

每张表使用固定 pgvector 维度：

```sql
embedding vector(1024)
embedding vector(1536)
embedding vector(3072)
```

优点：

- 能保留 pgvector 固定维度约束。
- 后续可以为每个维度表建立 HNSW/IVFFlat 索引。
- 查询性能和错误边界更清晰。
- 不同维度不会混入同一列。

缺点：

- 代码需要维护维度到表名的映射。
- 新增维度需要新增表和迁移。

### 3.2 不采用单表无维度 vector

不推荐把字段改成：

```sql
embedding vector
```

原因：

- 业务校验压力变大。
- 近似索引能力受限。
- 同表混维度后排查和迁移复杂。
- 后续大数据量下不好优化。

## 4. 数据模型调整

### 4.1 knowledge_bases

新增字段：

```prisma
model KnowledgeBase {
  id                     String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name                   String
  description            String   @default("")
  embeddingModelConfigId String   @map("embedding_model_config_id") @db.Uuid
  embeddingDimension     Int      @map("embedding_dimension")
  enabled                Boolean  @default(true)
  createdBy              String?  @map("created_by") @db.Uuid
  updatedBy              String?  @map("updated_by") @db.Uuid
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt              DateTime? @map("deleted_at") @db.Timestamptz(6)

  @@map("knowledge_bases")
}
```

迁移 SQL 示例：

```sql
ALTER TABLE "knowledge_bases"
ADD COLUMN "embedding_dimension" integer NOT NULL DEFAULT 1536;

CREATE INDEX "idx_knowledge_bases_embedding_dimension"
ON "knowledge_bases" ("embedding_dimension")
WHERE "deleted_at" IS NULL;
```

现有数据默认按 1536 维处理。

### 4.2 knowledge_embeddings_1536

如果保留旧表名，需要兼容成本。建议 v1 新增维度表，并将旧表迁入 1536 表。

```sql
CREATE TABLE "knowledge_embeddings_1536" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "knowledge_base_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE,
  "embedding_model_config_id" uuid NOT NULL REFERENCES "model_configs"("id"),
  "embedding" vector(1536) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_knowledge_embeddings_1536_chunk_id"
ON "knowledge_embeddings_1536" ("chunk_id");

CREATE INDEX "idx_knowledge_embeddings_1536_kb_model"
ON "knowledge_embeddings_1536" ("knowledge_base_id", "embedding_model_config_id");
```

### 4.3 knowledge_embeddings_1024

```sql
CREATE TABLE "knowledge_embeddings_1024" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "knowledge_base_id" uuid NOT NULL,
  "chunk_id" uuid NOT NULL REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE,
  "embedding_model_config_id" uuid NOT NULL REFERENCES "model_configs"("id"),
  "embedding" vector(1024) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_knowledge_embeddings_1024_chunk_id"
ON "knowledge_embeddings_1024" ("chunk_id");

CREATE INDEX "idx_knowledge_embeddings_1024_kb_model"
ON "knowledge_embeddings_1024" ("knowledge_base_id", "embedding_model_config_id");
```

### 4.4 旧表迁移策略

如果当前已有 `knowledge_embeddings` 表：

```sql
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
FROM "knowledge_embeddings";
```

迁移完成并验证后：

```sql
DROP TABLE "knowledge_embeddings";
```

如果开发环境数据不需要保留，可以 reset 后直接创建新表。

## 5. 代码结构

建议新增向量表路由工具：

```text
backend/src/modules/retrieval/
  vector-table.ts
```

职责：

- 根据维度返回表名。
- 校验当前维度是否被支持。
- 避免业务代码拼接任意表名。

示例：

```ts
const SUPPORTED_EMBEDDING_DIMENSIONS = [1024, 1536] as const;

export function getKnowledgeEmbeddingTable(dimension: number): string {
  if (dimension === 1024) {
    return "knowledge_embeddings_1024";
  }

  if (dimension === 1536) {
    return "knowledge_embeddings_1536";
  }

  throw new Error(`暂不支持 ${dimension} 维 Embedding 向量表`);
}
```

关键约束：

- 只允许从白名单返回表名。
- 不能把用户输入直接拼进 SQL。
- 新增维度时必须同步迁移和白名单。

## 6. 索引流程

### 6.1 当前流程

```text
上传文档
-> 解析文本
-> 切分 chunks
-> 调用知识库 embedding_model_config_id
-> 生成 embeddings
-> 写入 knowledge_embeddings
```

### 6.2 调整后流程

```text
上传文档
-> 读取 knowledge_base.embedding_model_config_id
-> 读取 knowledge_base.embedding_dimension
-> 解析文本
-> 切分 chunks
-> 调用 embedding 模型
-> 校验每个 embedding.length == embedding_dimension
-> 根据 embedding_dimension 选择向量表
-> 写入 knowledge_embeddings_{dimension}
```

### 6.3 关键代码约束

索引阶段必须在写入前校验：

```ts
if (embedding.length !== knowledgeBase.embeddingDimension) {
  throw new Error(
    `Embedding 向量维度不匹配：当前知识库需要 ${knowledgeBase.embeddingDimension} 维，但模型返回 ${embedding.length} 维。`
  );
}
```

中文注释要求：

```ts
// 知识库创建时已经锁定向量维度，这里提前校验，避免 pgvector 抛出难以理解的底层错误。
```

## 7. 检索流程

### 7.1 分组原则

检索必须按 `embedding_model_config_id` 分组。

原因：

- 同模型生成的文档向量和 query 向量处于同一向量空间。
- 不同模型即使维度相同，也不能直接混用。
- 不同维度更不能使用同一个 query embedding。

### 7.2 流程

```text
输入 query 和 knowledgeBaseIds
-> knowledge.getRetrievalConfigs(ids)
-> 按 embedding_model_config_id 分组
-> 每组调用一次 createEmbedding(query)
-> 校验 query embedding 维度 == 组内 knowledgeBase.embedding_dimension
-> 根据维度选择 knowledge_embeddings_{dimension}
-> 查询相似 chunks
-> 合并所有组结果
-> 排序截断
-> 返回 RetrievalContext
```

### 7.3 RetrievalConfig DTO

需要扩展：

```ts
export type KnowledgeRetrievalConfig = {
  id: string;
  name: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
};
```

### 7.4 查询 SQL

表名只能来自白名单函数：

```ts
const tableName = getKnowledgeEmbeddingTable(embeddingDimension);
```

SQL 示例：

```sql
SELECT
  e.knowledge_base_id,
  c.document_id,
  d.original_filename AS document_name,
  c.id AS chunk_id,
  c.chunk_index,
  c.content,
  1 - (e.embedding <=> $1::vector) AS score
FROM "knowledge_embeddings_1536" e
JOIN "knowledge_chunks" c ON c.id = e.chunk_id
JOIN "knowledge_documents" d ON d.id = c.document_id
WHERE e.knowledge_base_id = ANY($2::uuid[])
  AND e.embedding_model_config_id = $3::uuid
  AND c.deleted_at IS NULL
  AND d.deleted_at IS NULL
ORDER BY e.embedding <=> $1::vector
LIMIT $4;
```

## 8. Model Config 维度来源

v1 可以使用后端内置映射或模型配置字段。

推荐 v1 做法：

- `model_configs` 增加 `embedding_dimension` 可选字段。
- 创建 Embedding 模型配置时填写或测试后保存。
- 创建知识库时从 `model_configs.embedding_dimension` 读取。

如果暂时不改模型配置表，可以先用后端白名单：

```ts
const EMBEDDING_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "qwen-embedding-1024": 1024
};
```

长期推荐落库，原因是 OpenAI-compatible 模型名称不稳定，用户可能自定义模型。

## 9. 前端调整

### 9.1 创建知识库弹窗

新增展示：

- Embedding 模型选择。
- 模型维度。
- 创建后不可直接修改的提示。

### 9.2 知识库列表

新增列或信息：

- Embedding 模型名称。
- 向量维度。

### 9.3 文档列表

失败原因继续复用可读错误处理：

```text
Embedding 向量维度不匹配：当前知识库需要 1536 维，但模型返回 1024 维。
```

## 10. API 调整

### 10.1 创建知识库

请求：

```ts
type CreateKnowledgeBaseDto = {
  name: string;
  description?: string;
  embeddingModelConfigId: string;
};
```

服务端补齐：

```ts
embeddingDimension = modelConfig.embeddingDimension;
```

响应：

```ts
type KnowledgeBaseDetail = {
  id: string;
  name: string;
  description: string;
  embeddingModelConfigId: string;
  embeddingDimension: number;
  embeddingModelName?: string;
  documentCount: number;
  chunkCount: number;
};
```

### 10.2 更新知识库

v1 禁止更新：

- `embeddingModelConfigId`
- `embeddingDimension`

如果请求包含这两个字段，直接忽略或返回参数错误。建议返回参数错误，避免用户误以为修改生效。

## 11. 迁移步骤建议

### 11.1 第一步：表结构准备

- `knowledge_bases` 增加 `embedding_dimension`，现有数据默认 1536。
- 新建 `knowledge_embeddings_1536`。
- 新建 `knowledge_embeddings_1024`。
- 迁移旧 `knowledge_embeddings` 数据到 `knowledge_embeddings_1536`。

### 11.2 第二步：代码兼容

- 新增 `vector-table.ts`。
- 索引写入改为按维度选择表。
- 检索查询改为按维度选择表。
- 保留旧数据读取兼容，确认迁移后移除旧表。

### 11.3 第三步：检索分组

- `getRetrievalConfigs` 返回 `embeddingDimension`。
- `RetrievalService` 按 `embeddingModelConfigId` 分组。
- 每组单独生成 query embedding。
- 合并多组结果。

### 11.4 第四步：前端展示

- 知识库创建展示模型维度。
- 知识库列表展示模型和维度。
- 错误提示保持可读。

## 12. 测试计划

### 12.1 Service 测试

- 创建知识库时写入 `embeddingDimension`。
- 不支持维度时报错。
- 1024 维文档写入 `knowledge_embeddings_1024`。
- 1536 维文档写入 `knowledge_embeddings_1536`。
- 维度不匹配时不执行 raw SQL 写入。
- 检索按 `embeddingModelConfigId` 分组。
- 同时检索 1024 和 1536 知识库成功。

### 12.2 API 测试

- 创建知识库返回维度。
- 更新知识库不能修改 Embedding 模型。
- 文档重试后仍使用知识库绑定模型。

### 12.3 前端测试

- 创建知识库能看到模型维度。
- 知识库列表展示维度。
- 失败原因展示中文可读信息。

## 13. 风险与处理

### 13.1 分数不可直接比较

不同 Embedding 模型的分数分布不同。v1 可以先简单合并排序，但需要在文档中标注限制。

后续优化：

- rerank。
- 分组 topK 后再合并。
- 分数归一化。

### 13.2 新增维度需要迁移

按维度分表意味着新增维度需要新增表。

处理方式：

- v1 白名单只支持 1024、1536。
- 新增模型前先确认维度。
- 不支持维度时创建知识库失败并提示。

### 13.3 SQL 表名拼接风险

因为 Prisma 对 pgvector 支持有限，需要 raw SQL。表名必须从白名单函数返回，禁止使用用户输入直接拼接。

### 13.4 现有数据迁移风险

旧 `knowledge_embeddings` 数据迁移到 `knowledge_embeddings_1536` 后，需要验证：

- 行数一致。
- chunk 关联一致。
- 检索结果正常。

开发环境可以 reset，生产环境必须做备份。

## 14. 推荐实施顺序

1. 增加需求和技术文档。
2. 扩展 schema 和 migration。
3. 新增 `vector-table.ts` 和维度白名单。
4. 修改知识库创建，保存 `embeddingDimension`。
5. 修改索引写入，按维度分表。
6. 修改检索，按 Embedding 模型分组。
7. 修改前端展示模型维度。
8. 补测试。
9. 跑迁移、check、test、build。

