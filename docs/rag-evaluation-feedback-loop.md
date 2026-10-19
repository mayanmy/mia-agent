# Mia RAG 离线评估与线上反馈闭环技术方案

> 数据集管理、评估运行、指标报告和 Baseline/Candidate 对比的页面与接口实施细节，见 [`rag-evaluation-console-technical-design.md`](./rag-evaluation-console-technical-design.md)。

## 1. 文档信息

| 项目     | 内容                                                     |
| -------- | -------------------------------------------------------- |
| 状态     | Draft                                                    |
| 适用版本 | Mia v0.1+                                                |
| 目标读者 | 产品、前端、后端、测试和运维                             |
| 范围     | RAG 离线评估、线上反馈、失败样本沉淀、回归验证和发布观测 |

## 2. 背景与目标

Mia 已具备 Agent、知识库、RAG 检索、流式对话和日志能力。随着知识库、Prompt、模型和检索配置持续变化，需要一套可复现、可比较、可追踪的质量保障机制，用于回答：

- 回答质量下降发生在文档、召回、排序、上下文构造还是模型生成阶段。
- 调整切分、Embedding、Top K、Prompt 或模型后，效果是否真正改善。
- 线上用户差评能否转化为稳定的回归测试样本。
- 新配置上线前是否出现检索、忠实度、引用、延迟或成本回退。
- 配置和知识库变化后，历史评估结果是否仍然可解释。

目标闭环：

```text
线上对话与 RAG Trace
  -> 显式/隐式用户反馈
  -> 待标注问题池
  -> 人工审核和补充标准答案
  -> 版本化离线数据集
  -> Baseline/Candidate 对比评估
  -> 发布决策
  -> 线上指标持续观测
```

### 2.1 核心目标

1. 记录一次 RAG 调用的完整、受控、可检索 Trace。
2. 支持消息级点赞、点踩、原因标签和纠正答案。
3. 支持版本化数据集和不可变的评估运行快照。
4. 分别衡量检索、生成、引用和运行质量。
5. 将线上失败样本经过审核后沉淀为回归用例。
6. 支持同一数据集上的 Baseline 与 Candidate 配置对比。

### 2.2 非目标

- 不建设通用训练或自动微调平台。
- 不引入复杂实验平台、工作流编排系统或完整 A/B 测试平台。
- 不允许线上反馈未经审核直接修改 Prompt、知识库或模型配置。
- 第一版不以单一总分替代分层诊断。
- 第一版不自动执行生产发布或回滚。

## 3. 设计原则

### 3.1 分层诊断

检索、回答、引用和运行指标必须分别记录。单一总分无法定位质量问题产生在哪一层。

### 3.2 配置快照不可变

评估运行必须保存 Agent、知识库、检索、Prompt、模型和裁判配置快照，不能只引用当前配置。

### 3.3 反馈不是标准答案

点赞、点踩、重新生成和追问只是质量信号。样本进入正式回归集前必须经过人工审核、去重、脱敏和标注。

### 3.4 评估不阻塞在线请求

批量评估由后台 Job 执行。创建评估运行的 HTTP 请求只保存任务并返回 `run_id`。

### 3.5 遵守模块边界

模块只能直接访问所属数据表；跨模块读取必须调用对方 Service，并使用可 JSON 序列化的 DTO。

### 3.6 敏感信息最小化

Trace 默认保存 ID、版本、哈希和必要的受控快照。API Key、认证信息和无关敏感内容不得进入通用日志或评估结果。

## 4. 总体架构

```text
用户 -> chat.controller -> chat.service
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
      agents.service  retrieval.service  model_providers.service
                              |                |
                              +--------+-------+
                                       |
                                       v
                                  logs.service
                                       |
                            RAG Trace / Feedback Event
                                       |
                                       v
                              evaluations.service
                                       |
                                       v
                               rag-evaluation.job
                                       |
                    +------------------+------------------+
                    v                  v                  v
             retrieval.service model_providers.service logs.service
```

依赖方向：

```text
evaluations -> agents, retrieval, model_providers, logs
jobs -> evaluations
chat -> logs
```

新增依赖需同步更新项目模块依赖约束。禁止 `evaluations` 直接查询其他模块数据表。

## 5. 模块设计

### 5.1 新增 `evaluations` 模块

评估数据集、版本、用例、运行和结果具有独立生命周期，应新增模块：

```text
backend/src/modules/evaluations/
  evaluations.module.ts
  evaluations.controller.ts
  evaluations.service.ts
  dto/
    create-dataset.dto.ts
    create-case.dto.ts
    import-dataset.dto.ts
    create-run.dto.ts
    evaluation-dataset-detail.dto.ts
    evaluation-run-detail.dto.ts
    evaluation-result.dto.ts
    evaluation-comparison.dto.ts
  metrics/
    retrieval.metrics.ts
    answer.metrics.ts
    citation.metrics.ts
    runtime.metrics.ts
  graders/
    rule.grader.ts
    llm.grader.ts
  dataset-import.ts

backend/src/jobs/
  rag-evaluation.job.ts
```

职责：

- 管理评估数据集、版本和用例。
- 创建评估运行并保存配置快照。
- 计算确定性指标和聚合统计。
- 通过 `model_providers.service` 执行 LLM 裁判。
- 对比 Baseline 与 Candidate。
- 将审核后的线上反馈提升为评估用例。

禁止：

- 直接查询 Agent、Chat、Knowledge、Retrieval 或 Logs 所属表。
- 直接调用外部模型 SDK。
- 在 Controller 中执行批量评估。
- 自动修改 Agent、Prompt 或知识库配置。

### 5.2 `chat` 模块

- 接收消息级反馈。
- 校验当前用户是否有权反馈对应消息。
- 保存反馈业务数据。
- 将标准化反馈事件写入 `logs.service`。
- 对重新生成、停止生成等行为产生事件。

`chat` 不判断差评根因，也不直接将反馈加入正式数据集。

### 5.3 `retrieval` 模块

新增供在线对话和离线评估复用的稳定接口：

```typescript
type RetrievalEvaluationRequest = {
  requestId: string;
  query: string;
  knowledgeBaseIds: string[];
  config: RetrievalConfigSnapshot;
};

type RetrievalEvaluationResult = {
  query: string;
  rewrittenQuery?: string;
  candidates: RetrievalCandidate[];
  selectedChunks: RetrievalChunk[];
  sources: RetrievalSource[];
  elapsedMs: number;
};
```

要求：

- 返回候选结果、选中结果、排名、原始分数和重排分数。
- 评估运行传入固定配置快照，不在运行中隐式读取变化后的 Agent 配置。
- 文档和索引版本进入结果快照。

### 5.4 `model_providers` 模块

- 被评模型调用统一走 `create_chat_completion`。
- LLM 裁判使用相同统一入口，但配置独立并发配额。
- 裁判输出使用结构化 DTO，不返回 SDK 原始对象。
- 被评模型和裁判模型的用量、成本分别记录。

建议在请求 DTO 中增加调用场景：

```typescript
type ModelCallPurpose = "online_chat" | "offline_evaluation" | "evaluation_grader";
```

### 5.5 `logs` 模块

`logs` 保存运行观测和标准化事件，不承担评估业务状态。建议增加：

- `rag_trace_created`
- `message_feedback_created`
- `message_regenerated`
- `citation_clicked`
- `evaluation_run_started`
- `evaluation_run_finished`
- `evaluation_run_failed`

日志写入失败不得导致在线对话失败。

### 5.6 Job 编排

`rag-evaluation.job.ts`：

1. 加载运行和冻结的数据集版本。
2. 标记运行状态为 `running`。
3. 按并发限制逐条执行检索与回答。
4. 计算确定性指标。
5. 调用裁判模型计算语义指标。
6. 保存单题结果。
7. 聚合运行指标并生成 Gate 结论。
8. 更新为 `completed`、`failed` 或 `canceled`。

Job 必须幂等。使用 `run_id + case_id` 唯一约束，重复消费时跳过已完成用例或安全恢复未完成结果。

## 6. 数据模型

以下为逻辑模型，实际 Prisma 命名遵循仓库规范。

### 6.1 `rag_traces`

归属 `logs` 模块。

| 字段                        | 说明                   |
| --------------------------- | ---------------------- |
| `id`                        | Trace ID               |
| `request_id`                | 全链路请求 ID          |
| `session_id`、`message_id`  | 会话和 Assistant 消息  |
| `user_id`、`agent_id`       | 用户和 Agent           |
| `agent_config_snapshot`     | Agent 运行配置快照     |
| `query`、`rewritten_query`  | 原始和改写问题         |
| `retrieval_config_snapshot` | 检索配置快照           |
| `candidate_chunks`          | 候选 chunk、分数和排名 |
| `selected_chunks`           | 实际进入上下文的 chunk |
| `prompt_version`            | Prompt 版本            |
| `model_config_snapshot`     | 非敏感模型配置         |
| `answer`、`citations`       | 最终回答和引用         |
| `retrieval_elapsed_ms`      | 检索耗时               |
| `first_token_elapsed_ms`    | 首 token 耗时          |
| `total_elapsed_ms`          | 总耗时                 |
| `token_usage`               | Token 用量             |
| `status`、`error`           | 完成、失败或取消及错误 |
| `created_at`                | 创建时间               |

对 `request_id`、`message_id`、`agent_id + created_at` 建索引。

### 6.2 `message_feedback`

归属 `chat` 模块。

| 字段                                     | 说明               |
| ---------------------------------------- | ------------------ |
| `id`                                     | 反馈 ID            |
| `request_id`、`session_id`、`message_id` | 链路和消息         |
| `user_id`、`agent_id`                    | 用户和 Agent       |
| `rating`                                 | `up/down`          |
| `reason_codes`                           | 原因标签           |
| `comment`                                | 用户说明           |
| `corrected_answer`                       | 用户提供的理想答案 |
| `created_at`、`updated_at`               | 时间               |

使用 `(message_id, user_id)` 唯一约束支持更新反馈。

点踩原因：

- `wrong_answer`
- `missing_information`
- `wrong_retrieval`
- `wrong_citation`
- `outdated_content`
- `not_following_instruction`
- `too_verbose`
- `too_brief`
- `other`

### 6.3 评估表

`evaluation_datasets`：

- `id`、`name`、`description`
- `status: active/archived`
- `created_by`、`created_at`、`updated_at`

`evaluation_dataset_versions`：

- `id`、`dataset_id`、`version`
- `status: draft/frozen`
- `case_count`、`created_by`、`frozen_at`、`created_at`

冻结版本不可修改。变更时复制为新的 Draft 版本。

`evaluation_cases`：

- `id`、`dataset_version_id`
- `question`、`expected_answer`
- `expected_document_ids`、`expected_chunk_ids`
- `answerable`、`category`、`difficulty`
- `source_type: manual/import/online_feedback`
- `source_feedback_id`、`metadata`
- `created_by`、`created_at`

`evaluation_runs`：

- `id`、`dataset_version_id`、`agent_id`
- `baseline_run_id`
- `agent_config_snapshot`
- `retrieval_config_snapshot`
- `model_config_snapshot`
- `grader_config_snapshot`
- `status: pending/running/completed/failed/canceled`
- `progress`、`summary_metrics`
- `gate_result: passed/failed/warning`
- `created_by`、`started_at`、`finished_at`、`created_at`

`evaluation_case_results`：

- `id`、`run_id`、`case_id`
- `actual_answer`、`retrieved_chunks`、`citations`
- `retrieval_metrics`、`answer_metrics`
- `citation_metrics`、`runtime_metrics`
- `grader_details`
- `status: pending/completed/failed/skipped`
- `error`、`created_at`

对 `(run_id, case_id)` 建唯一约束。

## 7. API 设计

接口沿用 Mia 的鉴权、错误格式和 `X-Request-ID`。数据集、评估运行和样本晋升仅 Admin 可操作；User 可以提交自己的消息反馈。

### 7.1 消息反馈

```http
PUT /api/chat/messages/:messageId/feedback
```

```json
{
  "rating": "down",
  "reason_codes": ["wrong_retrieval", "wrong_citation"],
  "comment": "回答引用了旧版制度",
  "corrected_answer": "应以 2026 年制度为准"
}
```

```http
DELETE /api/chat/messages/:messageId/feedback
```

### 7.2 数据集

```text
GET    /api/evaluations/datasets
POST   /api/evaluations/datasets
GET    /api/evaluations/datasets/:datasetId
POST   /api/evaluations/datasets/:datasetId/versions
POST   /api/evaluations/dataset-versions/:versionId/cases
POST   /api/evaluations/dataset-versions/:versionId/import
POST   /api/evaluations/dataset-versions/:versionId/freeze
```

导入首版支持 UTF-8 CSV 和 JSONL：

```json
{
  "question": "员工出差住宿标准是多少？",
  "expected_answer": "按城市等级和职级执行对应限额。",
  "expected_document_ids": ["document-id"],
  "expected_chunk_ids": ["chunk-id"],
  "answerable": true,
  "category": "travel-policy"
}
```

### 7.3 评估运行

```text
POST /api/evaluations/runs
GET  /api/evaluations/runs
GET  /api/evaluations/runs/:runId
POST /api/evaluations/runs/:runId/cancel
GET  /api/evaluations/runs/:runId/results
GET  /api/evaluations/runs/:runId/comparison?baseline_run_id=...
```

创建请求：

```json
{
  "dataset_version_id": "dataset-version-id",
  "agent_id": "agent-id",
  "baseline_run_id": "optional-baseline-run-id",
  "overrides": {
    "retrieval": {
      "top_k": 8,
      "score_threshold": 0.55
    }
  }
}
```

服务端在创建时解析并保存完整配置快照，响应返回 `run_id` 和 `pending`。

### 7.4 反馈审核

```text
GET  /api/evaluations/feedback-candidates
POST /api/evaluations/feedback-candidates/:feedbackId/promote
POST /api/evaluations/feedback-candidates/:feedbackId/reject
```

晋升时必须确认目标 Draft 版本、标准答案、相关文档/chunk、是否可回答、分类和难度。

## 8. RAG Trace

### 8.1 记录时机

```text
message_start
  -> 创建 Trace 上下文
retrieval_start
  -> 记录检索配置
retrieval_result
  -> 记录候选和选中 chunk
model_stream
  -> 记录模型配置、首 token 和用量
message_end/error/cancel
  -> 保存回答、引用、耗时和状态
```

Trace 保存失败不能中断用户对话，必须进入错误日志。

### 8.2 文本策略

- `selected_chunks` 保存评估所需的受控文本快照、ID 和内容哈希。
- 大量候选结果只保存摘要、ID、分数和哈希。
- 敏感知识库可配置为仅保存 ID 和哈希。
- Trace 默认保留 90 天；正式数据集样本按数据集生命周期保留。

## 9. 评估指标

### 9.1 检索

| 指标                   | 说明                      |
| ---------------------- | ------------------------- |
| `HitRate@K`            | 前 K 个结果是否命中相关项 |
| `Recall@K`             | 相关项被召回的比例        |
| `MRR`                  | 第一个相关结果排名的倒数  |
| `nDCG@K`               | 衡量相关程度和排序质量    |
| `empty_retrieval_rate` | 空召回比例                |
| `retrieval_latency`    | 检索 P50/P95              |

首版重点展示 `HitRate@5`、`Recall@5`、`MRR` 和检索耗时。

### 9.2 回答

| 指标                    | 方式                         |
| ----------------------- | ---------------------------- |
| `answer_correctness`    | 标准答案/评分要点 + LLM 裁判 |
| `faithfulness`          | 答案是否被检索上下文支持     |
| `answer_relevance`      | 是否切中问题                 |
| `abstention_accuracy`   | 不可回答时是否正确拒答       |
| `instruction_following` | 是否遵守 Agent 指令          |

### 9.3 引用

- `citation_validity`：引用对象是否存在。
- `citation_correctness`：引用是否支持对应结论。
- `citation_completeness`：关键结论是否都有引用。

### 9.4 运行

- 成功率、失败率、取消率和超时率。
- 检索、首 token、总耗时 P50/P95。
- 输入、输出和总 Token。
- 被评模型与裁判模型的估算成本。

不适用或无法计算的指标使用 `null`，不能记为 0。

## 10. 裁判设计

### 10.1 规则裁判

- 回答是否为空。
- 引用格式和引用对象是否有效。
- 是否包含敏感或禁止内容。
- 是否超过延迟、Token 或成本阈值。
- 不可回答用例是否明确拒答。

### 10.2 LLM 裁判

分别计算正确性、忠实度、相关性和引用支持度：

```json
{
  "score": 0.8,
  "passed": true,
  "reason": "回答覆盖主要政策要求，但遗漏审批例外。",
  "evidence": ["chunk-id:12"],
  "failure_type": "partial_answer"
}
```

约束：

- 温度为 0 或接近 0。
- Rubric 和 Prompt 固定并版本化。
- 保存裁判模型、Prompt 版本和结构化结果。
- Faithfulness 只能依据本次检索上下文。
- 解析失败最多重试一次，仍失败则指标为 `null`。
- 每个数据集版本抽样人工复核，并统计人机一致率。

## 11. 执行流程和资源隔离

```text
创建运行
  -> 校验数据集已冻结
  -> 解析并保存配置快照
  -> 投递后台任务
  -> 执行检索
  -> 构造与线上一致的 RAG Prompt
  -> 调用被评模型
  -> 规则裁判
  -> LLM 裁判
  -> 保存单题结果
  -> 聚合指标
  -> 与 Baseline 对比
  -> 生成 Gate 结论
```

- 在线对话和离线评估使用不同并发配额。
- 首版离线评估并发建议为 2，裁判并发为 2。
- 在线繁忙时允许降低并发或暂停评估。
- 同一 Provider 仍受全局和 Provider 级并发限制。
- 取消运行时停止未开始用例，并取消正在进行的上游请求。
- 单题失败不终止整个运行。
- 系统性配置错误可直接终止运行。

## 12. Baseline/Candidate 对比

仅当数据集版本、指标版本和裁判配置兼容时允许直接对比。

报告包含：

- 汇总指标绝对值和变化量。
- 改善、退化和不变的用例数量。
- 按分类、难度和知识库拆分的指标。
- 仅 Candidate 失败的回归用例。
- 检索变化但回答未变化的用例。
- 成本和延迟变化。

必须支持下钻到单题，查看期望内容、实际召回、最终上下文、回答、引用和裁判理由。

## 13. 发布门禁

第一阶段只生成报告和警告，稳定后再接入 CI 或发布审批。

| 指标                 | 初始规则                            |
| -------------------- | ----------------------------------- |
| `Recall@5`           | 相比 Baseline 不下降超过 2 个百分点 |
| Faithfulness         | 平均值不得下降，严重失败不得增加    |
| Citation Correctness | 不得下降                            |
| Abstention Accuracy  | 不得下降                            |
| 超时率               | 不上升超过 1 个百分点               |
| P95 总耗时           | 不恶化超过 20%                      |
| 严重安全失败         | 必须为 0                            |
| 线上差评回归集       | 必须全部执行                        |

小样本分类必须同时显示样本数，避免误判波动。

## 14. 线上反馈闭环

### 14.1 显式反馈

- 点赞记录正向信号。
- 点踩至少选择一个原因，可填写说明和纠正答案。
- 修改反馈时更新同一记录，同时追加事件日志。

### 14.2 隐式反馈

逐步采集重新生成、停止生成、引用点击、复制回答和连续追问。隐式信号不能自动判定回答对错。

### 14.3 待标注池

优先级综合点踩原因、相似问题频率、业务重要度、空召回、低分召回、错误引用和现有用例覆盖情况。

```text
pending -> promoted
        -> rejected
        -> duplicate
```

### 14.4 数据集治理

- 正式评估只使用冻结版本。
- 每条用例可追踪来源和标注人。
- 文档更新后检查关联用例是否过期。
- 历史版本不删除用例，在新版本中移除或替换。
- 线上问题进入数据集前必须脱敏。

## 15. 前端方案

```text
frontend/src/features/evaluations/
  EvaluationsPage.tsx
  EvaluationDatasetPage.tsx
  EvaluationRunPage.tsx
  components/
    DatasetTable.tsx
    DatasetCaseTable.tsx
    FeedbackCandidateTable.tsx
    EvaluationRunForm.tsx
    EvaluationMetricsSummary.tsx
    EvaluationComparisonTable.tsx
    EvaluationCaseDetailDrawer.tsx
  hooks/
    useEvaluationRunPolling.ts
  api.ts
  types.ts
  utils.ts
```

路由页面使用 `React.lazy` 进行 route-level code splitting。

### 15.1 Chat 反馈

Assistant 消息操作区增加点赞、点踩及原因弹窗。反馈提交失败不影响当前会话，仅展示轻量重试提示。

### 15.2 评估管理

首版包括：

1. 数据集列表和版本状态。
2. 用例导入、编辑和冻结。
3. 待标注反馈审核。
4. 创建评估运行。
5. 查看进度和汇总指标。
6. Baseline/Candidate 对比。
7. 单题详情下钻。

## 16. 权限与安全

- User 只能反馈自己可访问的消息。
- Admin 管理数据集、审核反馈、运行评估和查看完整结果。
- 评估不能绕过知识库权限。
- Job 以创建者或明确的系统评估身份执行，并记录审计信息。
- 配置快照不得包含 API Key。
- 导出前检查文档和用户输入中的敏感信息。
- 日志和 Trace 设置保留周期并支持按权限清理。

## 17. 可观测性

记录：

- 队列等待时间和每分钟完成用例数。
- 被评模型和裁判模型成功率。
- Provider 限流、超时和熔断次数。
- 单次运行 Token 和估算成本。
- Trace 和评估结果写入失败次数。

所有日志贯穿 `request_id`，并补充 `run_id` 和 `case_id`。

## 18. 实施计划

### 阶段一：Trace 与反馈

- 增加完整 RAG Trace。
- 增加点赞、点踩和原因标签。
- 增加反馈管理查询。
- 完成敏感字段过滤和保留周期。

验收：任意在线回答可追溯检索候选、选中上下文、模型配置、回答、引用和耗时。

### 阶段二：数据集与基础评估

- 新增 `evaluations` 模块和数据表。
- 支持 CSV/JSONL 导入及版本冻结。
- 实现后台运行、检索和规则指标。
- 建立 50 至 100 条 Golden Set。

验收：同一冻结数据集可对两个配置运行并生成稳定对比。

### 阶段三：LLM 裁判与报告

- 增加正确性、忠实度、相关性和引用裁判。
- 增加 Baseline/Candidate 报告。
- 增加分类下钻和回归列表。
- 完成人工抽检和一致率记录。

验收：报告能够区分检索、生成、引用和运行失败。

### 阶段四：线上闭环与门禁

- 增加待标注反馈池。
- 支持审核、去重、脱敏和晋升。
- 增加软性发布门禁。
- 数据稳定后再决定是否启用 CI 硬阻断。

验收：线上点踩问题能经审核进入新数据集版本，并在 Candidate 中完成回归。

## 19. 测试策略

### 19.1 单元测试

- Recall、MRR、nDCG 计算。
- 引用有效性。
- 冻结后禁止修改。
- 配置快照脱敏。
- 裁判结构化结果解析和失败降级。
- Baseline/Candidate 差值。

### 19.2 Service 测试

- 创建数据集、版本、用例和运行。
- 非冻结版本禁止启动评估。
- 普通用户无权运行评估。
- 重复 Job 消费保持幂等。
- 单题失败不终止运行。
- 取消运行停止后续用例和上游请求。
- 反馈晋升保留来源并完成去重。

### 19.3 集成测试

- Chat 回答到 Trace 保存。
- 消息反馈到待标注池。
- 冻结数据集到评估报告。
- Provider 超时、429、取消和裁判解析失败。

## 20. 验收标准

1. 成功、失败或取消的 RAG 对话均产生可关联 Trace。
2. 用户可对 Assistant 消息点赞或点踩，并提交原因。
3. Admin 可创建数据集、导入用例并冻结版本。
4. Admin 可基于冻结版本创建后台评估运行。
5. 至少计算 `HitRate@5`、`Recall@5`、`MRR`、Faithfulness 和 Citation Correctness。
6. 结果包含单题详情、汇总指标、错误数、延迟和 Token。
7. 两个兼容运行可生成 Baseline/Candidate 对比。
8. 线上反馈可经审核和脱敏后晋升为新版本用例。
9. 离线评估不占满在线 LLM 并发，也不阻塞 Chat API。
10. 跨模块调用均经过公开 Service DTO，不直接跨模块查表。

## 21. 风险与应对

| 风险                      | 应对                                            |
| ------------------------- | ----------------------------------------------- |
| Golden Set 太小或分布失真 | 按业务分类建设，持续从线上补充，并展示样本数    |
| LLM 裁判不稳定            | 固定模型和 Prompt，低温度，结构化输出，人工抽检 |
| 文档更新导致答案过期      | 记录文档版本，在新数据集版本中审核关联用例      |
| Trace 数据增长过快        | 候选摘要化、设置保留周期、正式用例单独保存      |
| 离线任务影响在线调用      | 独立并发、低优先级队列、繁忙时暂停              |
| 反馈含敏感信息            | 晋升前脱敏、权限隔离、限制导出                  |
| 平均分掩盖严重问题        | 分层和分类指标、严重失败计数、单题下钻          |
| 自动门禁误报              | 初期只告警，稳定后再启用硬阻断                  |

## 22. 后续扩展

- Query 改写、Chunk 切分、Embedding 和 Rerank 的消融实验。
- 多模型、多 Prompt 和多检索配置矩阵评估。
- 数据集覆盖率和重复度分析。
- 文档更新后的用例过期提醒。
- 线上分桶实验和长期趋势看板。
- 人工确认后的失败类型聚类。

扩展不得改变首版边界：在线对话由 `chat` 编排，检索由 `retrieval` 执行，模型调用统一经过 `model_providers`，评估业务由 `evaluations` 管理，批处理由 `jobs` 编排。
