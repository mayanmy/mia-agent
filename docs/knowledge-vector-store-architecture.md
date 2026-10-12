# 知识库向量存储架构选型文档

## 1. 背景

Mia 当前知识库向量存储使用 PostgreSQL + pgvector。为了支持不同 Embedding 模型的向量维度，当前已经演进为按维度分表：

```text
knowledge_embeddings_1024
knowledge_embeddings_1536
knowledge_embeddings_3072
```

这种方案适合 Mia 当前轻量、本地部署、单团队使用的阶段。但对比 Dify 的知识库设计，可以看到另一种更适合长期演进的模式：

```text
一个知识库 Dataset ↔ 一个 Qdrant Collection
```

本文用于分析 Dify 模式和 Mia 当前模式的差异，并给出 Mia 后续向量存储架构的长期建议。

## 2. Dify 的设计模式

Dify 采用接近如下的一对一绑定设计：

```text
Dataset A -> Qdrant Collection A
Dataset B -> Qdrant Collection B
Dataset C -> Qdrant Collection C
```

在这个模式下，一个知识库就是一个独立向量检索单元。每个 Collection 可以独立配置：

- 向量维度。
- distance metric。
- HNSW 索引参数。
- payload schema。
- metadata filter。
- 重建策略。
- 删除策略。
- 多向量字段。
- 后续迁移策略。

这种设计的核心思想是：

```text
知识库 = 向量存储隔离单元
```

## 3. Dify 如何处理 PG 与 Qdrant 一致性

Dify 这类架构不会把 PostgreSQL 和 Qdrant 做成强一致的分布式事务。更常见、也更适合 RAG 系统的方式是：

```text
PostgreSQL = 业务元数据和状态的 source of truth
Qdrant = 可重建的派生向量索引
```

也就是说，PG 负责回答“文档是否存在、索引是否完成、失败原因是什么”，Qdrant 负责回答“哪些向量和 query 最相似”。如果 Qdrant 中的数据异常，系统应能通过 PG 中的文档、chunk 和任务状态重新构建。

### 3.1 状态先落 PG

索引任务开始后，系统先在 PG 中记录文档处理状态，例如：

```text
uploaded -> parsing -> chunking -> embedding -> indexing -> completed
```

这样即使后续解析、Embedding 或 Qdrant 写入失败，前端和后台任务也能通过 PG 查到文档当前卡在哪个阶段。

原则：

- 不把“任务正在进行中”只放在内存里。
- 慢任务开始前先更新 PG 状态。
- 每个关键阶段完成后及时 commit。

### 3.2 分阶段提交

文档索引通常分成多个阶段：

```text
解析原文
-> 写入文档文本/解析结果
-> 切分 chunk
-> 写入 chunks
-> 生成 embeddings
-> 写入 Qdrant
-> 更新 PG 为 completed
```

每个阶段可以独立提交 PG 状态，避免一个长事务持有太久锁。Qdrant 写入成功后，再把 PG 中的文档和 segment 状态标记为 completed。

关键含义：

```text
PG completed = 向量索引流程已经走完
PG error = 向量索引不可用，需要重试或重建
```

### 3.3 失败时 PG 记录 error

如果 Qdrant 写入失败，不应该让 PG 仍然显示索引成功。失败处理应该写回：

- 文档状态：`error` / `failed`
- 失败阶段：`embedding` / `vector_indexing`
- 错误信息：可读错误
- 结束时间

这样用户看到的是：

```text
索引失败：向量库写入失败，请重试
```

而不是静默失败，或在聊天时才发现检索不到。

### 3.4 Qdrant Collection 懒创建

在 Dataset ↔ Collection 模式下，Collection 可以在第一次写入向量前创建。

需要注意并发问题：

```text
多个索引任务同时发现 Collection 不存在
-> 同时尝试创建
```

因此需要使用锁或幂等创建策略：

- Redis lock。
- 数据库锁。
- 捕获 collection already exists。
- 本地缓存 collection exists 状态。

Mia 后续如果引入 Qdrant，也应避免多个文档并发上传时重复创建 Collection。

### 3.5 删除操作幂等

删除文档或知识库时，Qdrant 清理应该设计成幂等：

```text
删除同一个 doc_id 多次不会报错
Collection 不存在时视为已经删除
部分 point 已不存在时继续完成
```

推荐删除条件：

```text
collection_name = knowledge_base.vector_collection_name
payload.doc_id = document.id
payload.knowledge_base_id = knowledge_base.id
```

这样即使某次删除任务失败，后续重试也可以安全执行。

### 3.6 重建索引修复不一致

因为 PG 和 Qdrant 没有分布式事务，所以必须承认可出现短暂不一致，并提供修复手段：

```text
以 PG 中的 documents/chunks 为准
-> 删除旧 Collection 或旧 points
-> 重新生成 / 重新写入向量
-> 校验数量
-> 更新 PG 状态
```

这也是为什么向量库应被视为“可重建索引”，而不是唯一真相。

### 3.7 对账任务

长期运行后，需要后台对账任务发现不一致：

```text
PG completed 文档数量
PG chunk 数量
Qdrant point 数量
Qdrant payload 中 doc_id 覆盖情况
```

发现异常后可以：

- 标记知识库为 `degraded`。
- 标记文档为 `index_inconsistent`。
- 触发重建索引。
- 通知管理员。

### 3.8 对 Mia 的启示

Mia 如果后续引入 Qdrant，不应追求 PG + Qdrant 强事务，而应采用最终一致模型：

```text
PG 记录知识库、文档、chunk、索引状态
Qdrant 保存可重建向量索引
索引任务分阶段提交状态
写入 Qdrant 成功后再标记 completed
失败时写入 error
删除和重建操作保持幂等
定期对账并支持重建修复
```

这套方式比引入分布式事务更简单、可靠，也更符合 RAG 索引系统的工程特点。

## 4. Mia 当前设计模式

Mia 当前使用 PostgreSQL + pgvector，并按向量维度分表：

```text
PostgreSQL
  knowledge_bases
  knowledge_documents
  knowledge_chunks
  knowledge_embeddings_1024
  knowledge_embeddings_1536
  knowledge_embeddings_3072
```

这种设计的核心思想是：

```text
向量维度 = 向量存储隔离单元
知识库 = 向量表中的业务字段
```

不同知识库可以使用不同 Embedding 维度，但检索时需要根据知识库的 `embedding_dimension` 和 `embedding_model_config_id` 选择对应分表，并按 Embedding 模型分组查询。

## 5. 两种模式的核心差异

| 维度 | Dify Collection 模式 | Mia pgvector 分表模式 |
| --- | --- | --- |
| 隔离单元 | 知识库 | 向量维度 |
| 向量维度 | 每个 Collection 独立 | 每个维度一张表 |
| 检索入口 | 按知识库查对应 Collection | 按模型分组后查对应维度表 |
| 删除知识库 | 删除 Collection + 元数据 | 删除业务数据 + 清理分表向量 |
| 重建知识库 | 可新建临时 Collection 后切换 | 需要清理旧向量并重写分表 |
| 索引参数 | 每个 Collection 可独立配置 | 同维度表共享配置 |
| 扩展模型维度 | 创建新 Collection 即可 | 新增维度需要建表和迁移 |
| 部署复杂度 | 高，需要维护向量数据库 | 低，只依赖 PostgreSQL |
| 事务一致性 | 需要协调 PG 和 Qdrant | PG 内一致性更简单 |
| 长期检索能力 | 更强 | 中小规模够用 |

## 6. Dify 模式的优势

### 6.1 检索编排更简单

每个知识库对应自己的 Collection。检索时只需要：

```text
找到知识库 -> 找到 collection_name -> 在该 Collection 中检索
```

不需要关心该知识库属于哪个维度分表，也不需要在 SQL 中动态切换表名。

### 6.2 知识库生命周期更清晰

删除知识库：

```text
删除 PostgreSQL 元数据
删除 Qdrant Collection
```

重建知识库：

```text
创建临时 Collection
重新写入全部向量
重建完成后切换 collection_name
删除旧 Collection
```

这种模式天然适合后续做无损重建、回滚和灰度切换。

### 6.3 更适合多模型和多维度

不同知识库可以使用完全不同的 Embedding 模型：

```text
知识库 A：1536 维
知识库 B：1024 维
知识库 C：3072 维
```

每个 Collection 自带自己的 vector size，不需要为每个维度维护全局表结构。

### 6.4 更适合大规模检索

Qdrant 这类向量数据库专门处理：

- 高维向量检索。
- HNSW 索引。
- payload filter。
- collection 级别优化。
- segment 管理。
- 大规模数据写入和查询。

数据量增长后，比直接依赖 pgvector 更容易做性能调优。

## 7. Dify 模式的成本

### 7.1 基础设施更复杂

需要额外部署和维护 Qdrant：

```text
PostgreSQL：业务元数据
Qdrant：向量数据
文件存储：原始文档
```

这会增加本地部署、备份、恢复和监控成本。

### 7.2 一致性需要额外处理

文档、chunk 元数据在 PostgreSQL，向量在 Qdrant。写入流程可能出现：

```text
PG 写入成功，但 Qdrant 写入失败
Qdrant 写入成功，但 PG 状态更新失败
删除 PG 文档后，Qdrant 向量清理失败
```

因此需要补充：

- 幂等写入。
- 重试任务。
- 失败状态。
- 对账任务。
- 重建能力。

### 7.3 对 Mia 当前阶段偏重

Mia 当前定位是团队或组织内部、本地部署、单人可维护。早期引入 Qdrant 会让系统复杂度上升，开发和排障成本变高；是否拆分向量数据库应由数据量、检索吞吐和运维能力决定，而不是按固定用户数判断。

## 8. Mia 当前模式的优势

### 8.1 部署简单

只需要 PostgreSQL + pgvector：

```text
业务数据、chunk、embedding 都在同一个数据库
```

本地开发、备份和迁移都更直接。

### 8.2 事务一致性更好

文档、chunk、embedding 都在 PostgreSQL 中，虽然 pgvector 写入需要 raw SQL，但整体仍然比跨两个存储系统更容易保持一致。

### 8.3 更适合 v1 快速落地

当前 Mia 的优先级是完成最小闭环：

```text
配置模型 -> 创建知识库 -> 上传文档 -> 索引 -> Agent 检索 -> Chat 引用
```

pgvector 分表可以支撑这个闭环，不需要立刻引入额外向量数据库。

## 9. Mia 当前模式的局限

### 9.1 新增维度需要建表

例如新增 768 维模型时，需要新增：

```text
knowledge_embeddings_768
```

同时修改：

- Prisma schema。
- migration。
- 写入表名白名单。
- 检索表名白名单。
- 删除清理逻辑。

### 9.2 知识库隔离不够自然

同维度知识库共享同一张向量表。删除、重建、迁移都需要依赖业务字段过滤。

### 9.3 索引参数无法按知识库独立

如果后续要给不同知识库设置不同 HNSW 参数、不同 distance metric 或不同检索策略，pgvector 分表会比较别扭。

### 9.4 长期会增加 service 复杂度

随着能力增长，RetrievalService 会逐渐处理：

- 按模型分组。
- 按维度选表。
- 分数合并。
- metadata filter。
- 重建索引。
- 多维度清理。

这会让业务 service 变厚，需要进一步抽象。

## 10. 长期推荐方案

长期看，Mia 更适合演进为：

```text
PostgreSQL 管业务元数据
向量数据库管 embedding 向量
一个知识库对应一个向量 Collection
```

推荐目标结构：

```text
knowledge_bases
  id
  name
  embedding_model_config_id
  embedding_dimension
  vector_store_type
  vector_collection_name
  vector_status

Qdrant
  collection: mia_kb_{knowledge_base_id}
```

核心思想：

```text
知识库生命周期 = Collection 生命周期
```

这样更适合后续支持：

- 知识库独立重建。
- 知识库切换 Embedding 模型。
- 知识库级索引参数。
- 多向量字段。
- 大规模向量检索。
- 外部向量库扩展。

## 11. 推荐演进路线

### 11.1 v1：保留 pgvector 分表

当前阶段继续使用：

```text
knowledge_embeddings_1024
knowledge_embeddings_1536
knowledge_embeddings_3072
```

原因：

- 已经满足不同知识库不同维度。
- 部署简单。
- 开发成本低。
- 适合 Mia 当前本地单体阶段。

### 11.2 v1.5：抽象 VectorStore

下一步不要继续把向量写入和检索逻辑散在 `KnowledgeService` / `RetrievalService` 中，而是抽象：

```text
VectorStore
  upsertChunks()
  deleteDocument()
  deleteKnowledgeBase()
  search()
  rebuildKnowledgeBase()
```

当前实现：

```text
PgvectorVectorStore
```

未来新增：

```text
QdrantVectorStore
```

这样可以让业务模块不关心底层向量存储。

### 11.3 v2：支持 Collection-per-KnowledgeBase

当出现以下需求时，再引入 Qdrant：

- 单知识库 chunk 数量明显增长。
- 需要更强 metadata filter。
- 需要知识库无损重建和切换。
- 需要每个知识库独立索引参数。
- 需要支持更多向量维度。
- pgvector 分表维护成本开始变高。

v2 推荐引入：

```text
QdrantVectorStore
knowledge_base.vector_collection_name
knowledge_base.vector_store_type
```

### 11.4 v2.1：迁移现有 pgvector 数据

迁移流程：

```text
遍历 knowledge_bases
-> 创建 Qdrant Collection
-> 读取 knowledge_chunks + pgvector embeddings
-> 写入 Qdrant
-> 校验数量
-> 更新 vector_store_type / vector_collection_name
-> 切换检索流量
```

迁移需要支持回滚，因此不能直接删除 pgvector 表。

## 12. 推荐最终判断

### 12.1 当前阶段

Mia 当前继续使用 PostgreSQL + pgvector 分表更合适。

理由：

- 项目仍处在知识库 v1 能力建设期。
- 本地部署和单人维护优先。
- 数据规模尚未证明需要独立向量数据库。
- 当前分表方案已经解决 1024/1536/3072 维度问题。

### 12.2 长期阶段

长期建议向 Dify 类似模式演进：

```text
一个知识库 -> 一个向量 Collection
```

理由：

- 知识库生命周期更清晰。
- 检索编排更简单。
- 多模型、多维度、多索引参数支持更自然。
- 大规模向量检索更专业。
- 更适合未来拆分 Retrieval 服务。

## 13. 结论

Dify 的 Dataset ↔ Qdrant Collection 一对一模式，在检索和长期演进上更优。

Mia 当前 pgvector 分表方案，在 v1 本地部署和快速交付阶段更划算。

最终建议：

```text
短期：保留 pgvector 分表，完成知识库闭环。
中期：抽象 VectorStore，隔离底层向量存储。
长期：引入 Qdrant，实现一个知识库一个 Collection。
```

不要马上推倒当前方案，但后续新增检索能力时，应优先把向量存储操作收敛到 `VectorStore` 抽象中，为迁移到 Collection-per-KnowledgeBase 留好接口边界。
