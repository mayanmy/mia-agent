# Mia RAG 评估控制台技术方案

## 1. 文档定位

本文是 [`rag-evaluation-feedback-loop.md`](./rag-evaluation-feedback-loop.md) 的实施细化，聚焦以下四类管理能力：

1. 可视化评估数据集与版本管理。
2. 创建、取消和观测离线评估运行。
3. 查看检索、回答、引用和运行指标报告。
4. 执行 Baseline/Candidate 对比并下钻回归样本。

本文不重复定义线上 RAG Trace 和用户反馈采集。反馈晋升数据集的入口保留在信息架构中，但其审核工作流仍按总方案第四阶段实现。

### 1.1 交付边界

首个可用版本分为两个增量：

| 增量        | 能力                                                             | 依赖                      |
| ----------- | ---------------------------------------------------------------- | ------------------------- |
| A：基础评估 | 数据集、版本、用例、冻结、评估运行、规则指标、运行报告、基础对比 | 阶段一 Trace 与反馈已落地 |
| B：语义评估 | LLM 裁判、正确性、忠实度、相关性、引用支持度、Gate 与失败分类    | 增量 A 稳定、裁判模型可用 |

前端从第一天保留四类指标分组；尚未启用 LLM 裁判时，语义指标显示“未启用”，不得显示为 0。

### 1.2 非目标

- 不做通用实验平台和任意指标 DSL。
- 不做生产配置自动发布或自动回滚。
- 不允许直接修改冻结版本。
- 不在 HTTP 请求内同步执行批量评估。
- 不把所有指标合成一个不透明总分。
- 不将未经审核的用户点踩自动加入 Golden Set。

## 2. 用户与核心任务

### 2.1 角色

首版沿用工作空间权限：

| 工作空间角色 | 数据集 | 评估运行 | 报告与对比 |
| ------------ | ------ | -------- | ---------- |
| OWNER        | 管理   | 管理     | 查看       |
| MANAGER      | 管理   | 管理     | 查看       |
| MEMBER       | 不可见 | 不可见   | 不可见     |

平台级 `UserRole.ADMIN` 不自动获得其他工作空间的数据访问权，仍必须通过当前工作空间上下文校验。

### 2.2 核心任务

- 管理员导入一批标准问题，补齐期望答案和相关文档后冻结版本。
- 管理员选择冻结版本与 Agent，创建 Candidate 评估运行。
- 管理员观察进度、失败数、预计剩余时间并按需取消。
- 管理员查看分层指标，定位检索、生成、引用或运行问题。
- 管理员选择兼容的历史运行作为 Baseline，查看退化指标和回归用例。
- 管理员进入单题详情，核对问题、期望、召回、回答、引用和裁判理由。

## 3. 信息架构与路由

评估属于“观测”而非 Agent 编辑能力，挂载到现有 `/operations` 区域。

```text
/operations
  /traces                         现有运行记录
  /logs                           现有工具日志
  /evaluations                    评估运行列表（默认评估入口）
  /evaluations/runs/:runId        单次运行报告
  /evaluations/compare            Baseline/Candidate 对比
  /evaluation-datasets            数据集列表
  /evaluation-datasets/:datasetId 数据集详情和版本管理
```

`OperationSectionTabs` 增加：

- “评估运行” -> `/operations/evaluations`
- “评估数据集” -> `/operations/evaluation-datasets`

运行详情和对比页不作为独立 Tab，但保留稳定 URL、浏览器返回行为和刷新恢复能力。

所有新页面使用 `React.lazy`。列表筛选条件写入 URL Search Params，便于刷新、分享和返回后恢复。

## 4. 页面设计

### 4.1 数据集列表页

路由：`/operations/evaluation-datasets`

页面结构：

```text
标题：评估数据集                         [新建数据集]
说明：管理可复现的 RAG Golden Set

[关键词] [状态] [更新时间] [重置]

数据集表格
名称 | 当前版本 | 状态 | 用例数 | 最近冻结时间 | 更新时间 | 操作
```

行为：

- 默认按 `updated_at desc` 排序。
- 状态支持 `active/archived`。
- “当前版本”优先显示最新冻结版本；只有 Draft 时显示 Draft 标签。
- 点击行或“查看”进入数据集详情。
- 归档是可恢复状态，不物理删除历史版本和运行引用。
- 空状态提供“新建数据集”和“导入示例”说明，不显示空表格。

新建弹窗字段：

- 名称：必填，1-100 字符。
- 描述：可选，最多 1000 字符。

### 4.2 数据集详情页

路由：`/operations/evaluation-datasets/:datasetId`

页头：

```text
[返回] 差旅制度问答集 [ACTIVE]
说明文本
版本：v3 FROZEN ▼              [从版本复制 Draft] [导入] [新增用例] [冻结版本]
```

主体使用两个区域：

1. 版本摘要：版本号、状态、用例数、创建者、创建时间、冻结时间。
2. 用例表格：问题、分类、难度、可回答、期望文档数、来源、更新时间、操作。

版本切换规则：

- URL 使用 `?versionId=...` 保存当前版本。
- 切换版本不改变路由页，避免丢失列表筛选上下文。
- Frozen 版本所有编辑入口禁用，并显示“冻结版本不可修改；请复制为新 Draft”。
- 一个数据集首版最多允许一个 Draft，防止多人产生无法识别的分叉。

用例编辑抽屉：

- 问题：必填。
- 标准答案：可选；`answerable=true` 且启用回答正确性指标时建议填写。
- 可回答：布尔值。
- 期望文档：多选，调用 Knowledge Service 的受限查询接口。
- 期望 Chunk：按已选文档懒加载，不一次加载整库 Chunk。
- 分类、难度：可选但使用稳定枚举/受控文本。
- 元数据：首版只读展示，不开放任意 JSON 编辑器。

导入流程：

```text
选择 UTF-8 CSV/JSONL
  -> 上传并仅解析
  -> 返回校验预览和错误行
  -> 用户确认
  -> 原子写入合法批次
```

导入预览至少显示：总行数、合法数、错误数、重复数、前 20 条合法样本和全部错误行下载入口。默认遇到错误不部分写入；用户可显式选择“仅导入合法行”。

冻结前确认弹窗显示：用例总数、缺少标准答案数、没有期望文档/Chunk 数、不可回答用例数。警告不一定阻止冻结，但空数据集必须阻止。

### 4.3 评估运行列表页

路由：`/operations/evaluations`

页面结构：

```text
标题：RAG 评估运行                         [创建评估]

[状态] [数据集] [Agent] [创建者] [时间范围] [重置]

运行表格
状态 | 数据集版本 | Agent | 进度 | 关键指标 | Gate | 创建者 | 开始时间 | 操作
```

状态展示必须同时使用文本和图标/Tag，不能只靠颜色：

- `pending`：等待执行。
- `running`：显示完成数/总数和进度条。
- `completed`：显示完成时间。
- `failed`：显示可操作的错误摘要。
- `canceled`：显示取消时间和已完成数。

关键指标列首版显示 `Recall@5`、成功率和 P95 总耗时。尚未计算时显示 `—`，不是 `0`。

创建评估抽屉：

1. 选择冻结的数据集版本。
2. 选择 Agent。
3. 选择配置模式：
   - 当前 Agent 配置快照。
   - 当前配置 + 允许的检索覆盖项。
4. 可选选择 Baseline。
5. 展开“高级设置”后配置 Top K、分数阈值和裁判模型。
6. 提交前显示最终不可变快照摘要。

Baseline 下拉只返回兼容运行。若用户通过 URL 带入不兼容 Baseline，服务端返回具体不兼容字段，前端在字段下方展示原因。

### 4.4 运行报告页

路由：`/operations/evaluations/runs/:runId`

页面从上到下分为六区：

#### A. 运行头部

- 状态、数据集版本、Agent、创建者、开始/结束时间。
- 操作：取消、重新运行、选择 Baseline 对比、复制链接。
- `pending/running` 显示进度与预计剩余时间。
- `failed` 显示错误分类和恢复建议，不能只显示“运行失败”。

#### B. Gate 摘要

- `passed/failed/warning/not_evaluated`。
- 显示每条门禁规则、当前值、阈值、与 Baseline 差值和结论。
- 增量 A 没有 Baseline 时显示“仅报告，未执行回归门禁”。

#### C. 指标卡片

分组展示，不提供不透明总分：

| 分组 | 指标                                                    |
| ---- | ------------------------------------------------------- |
| 检索 | HitRate@5、Recall@5、MRR、空召回率、检索 P50/P95        |
| 回答 | 正确性、忠实度、相关性、拒答准确率                      |
| 引用 | 有效性、正确性、完整性                                  |
| 运行 | 成功率、失败率、超时率、总耗时 P50/P95、Token、估算成本 |

每张指标卡必须显示：值、有效样本数/总样本数、`null` 数量、与 Baseline 差值。样本数小于配置阈值时显示“小样本”警告。

#### D. 指标可视化

- Baseline/Candidate 精确对比使用分组水平条形图。
- 延迟展示 P50/P95 分组条形图。
- 分类和难度拆分使用可排序表格或不超过 15 项的水平条形图。
- 不使用雷达图作为主报告，因为它不利于读取精确差值。
- 所有图表必须有直接数值标签，并提供同数据表格作为无障碍替代。

首版复用现有依赖；如果仓库没有图表库，优先用 CSS 条形图完成，不为四个简单图引入大型可视化依赖。

#### E. 用例结果表

列：

- 状态。
- 问题。
- 分类/难度。
- 检索命中。
- 回答正确性/忠实度。
- 引用指标。
- 总耗时。
- 失败类型。
- 与 Baseline 结论。

筛选：状态、分类、难度、失败类型、仅看回归、仅看空召回、仅看无效指标。

默认排序优先级：严重失败、Candidate 独有回归、普通失败、成功。分页由服务端执行。

#### F. 单题详情抽屉

抽屉宽度桌面端建议 840-960px，小屏占满可视宽度。内容：

1. 问题与标准答案。
2. 期望文档/Chunk。
3. 实际候选和选中 Chunk，展示排名、分数、通道和受控文本快照。
4. 最终回答与引用。
5. 规则指标与 LLM 裁判理由。
6. 运行耗时、Token、模型配置。
7. Baseline 同题结果，可切换“并排/仅差异”。

长文本默认折叠，复制按钮必须有可访问名称。Chunk ID、Request ID 使用等宽字体且允许复制。

### 4.5 Baseline/Candidate 对比页

路由：`/operations/evaluations/compare?baselineRunId=...&candidateRunId=...`

页面结构：

```text
Baseline [运行 A ▼]       Candidate [运行 B ▼]       [交换]
兼容性：通过 / 不兼容原因

Gate 结论与关键回归摘要
指标绝对值与 Delta
改善 / 不变 / 退化数量
分类、难度拆分
回归用例表
```

比较规则：

- 正向指标 Delta：`candidate - baseline`。
- 延迟、成本、失败率等负向指标也保留数学 Delta，但 UI 明确标注“越低越好”，避免正数被误认为改善。
- Delta 同时显示绝对差和相对变化；Baseline 为 0 时相对变化显示 `N/A`。
- 使用“改善/退化”文字和方向图标，不只使用红绿颜色。
- 默认先展示退化，不默认展示全部成功样本。

用例结论：

```text
improved   Candidate 从失败变为通过，或关键分数越过通过阈值
regressed  Baseline 通过而 Candidate 失败，或严重失败等级上升
unchanged  终态和关键指标在容差范围内一致
mixed      检索改善但回答退化，或不同层指标方向冲突
```

## 5. 前端工程结构

```text
frontend/src/features/evaluations/
  api.ts
  types.ts
  utils.ts
  evaluations.less
  EvaluationRunsPage.tsx
  EvaluationRunPage.tsx
  EvaluationComparisonPage.tsx
  EvaluationDatasetsPage.tsx
  EvaluationDatasetPage.tsx
  components/
    CreateDatasetModal.tsx
    DatasetVersionHeader.tsx
    DatasetCaseTable.tsx
    DatasetCaseDrawer.tsx
    DatasetImportModal.tsx
    FreezeVersionModal.tsx
    CreateEvaluationRunDrawer.tsx
    EvaluationRunStatus.tsx
    EvaluationProgress.tsx
    EvaluationMetricCard.tsx
    EvaluationMetricsSummary.tsx
    EvaluationGatePanel.tsx
    MetricComparisonBars.tsx
    EvaluationCaseResultTable.tsx
    EvaluationCaseDetailDrawer.tsx
    RunCompatibilityAlert.tsx
  hooks/
    useEvaluationRunPolling.ts
    useEvaluationFilters.ts
```

边界：

- 页面负责路由参数、加载编排和区域组合。
- 表格列可以放在对应组件内，但 API 请求只能在 `api.ts`。
- 运行轮询只放 `useEvaluationRunPolling`。
- 指标格式、Delta 语义和 null 处理只放 `utils.ts`，避免各页面口径不同。
- 详情抽屉只展示 DTO，不根据当前 Agent 配置重新推导历史结果。

## 6. 前端状态与刷新策略

### 6.1 服务端状态优先

数据集版本、运行状态、进度和报告均以服务端为权威。前端只允许对创建、取消等操作做按钮 loading，不乐观修改终态。

### 6.2 轮询

首版使用条件轮询，不额外引入 WebSocket：

- `pending/running`：前台可见时每 2 秒查询运行摘要。
- 页面隐藏：退避到 10 秒。
- `completed/failed/canceled`：立即停止轮询并刷新一次结果列表。
- 连续三次网络失败：停止自动轮询，显示“连接中断，手动重试”。
- 使用 `AbortController` 取消卸载页面和切换 runId 后的旧请求。
- 对响应增加 `updatedAt/version`，旧响应不得覆盖新状态。

列表页只轮询可见页中的运行中项目，调用批量状态接口，避免 N+1 请求。

### 6.3 URL 状态

以下状态进入 URL：分页、筛选、排序、版本 ID、Baseline/Candidate Run ID、单题结果筛选。抽屉是否打开可用 `caseResultId` 表示，从而支持分享单题链接。

## 7. 后端模块与职责

新增模块：

```text
backend/src/modules/evaluations/
  evaluations.module.ts
  evaluations.controller.ts
  evaluations.service.ts
  dataset-import.ts
  metrics/
    retrieval.metrics.ts
    answer.metrics.ts
    citation.metrics.ts
    runtime.metrics.ts
    aggregate.metrics.ts
  graders/
    rule.grader.ts
    llm.grader.ts
  dto/

backend/src/jobs/
  rag-evaluation.job.ts
```

职责边界：

- `evaluations` 直接访问且只访问评估所属表。
- Agent 运行快照通过 `agents.service` 获取。
- 知识库可选项和版本信息通过 `knowledge.service` 获取。
- 检索执行通过 `retrieval.service` 的评估接口。
- 模型和裁判调用通过 `model_providers.service`。
- 标准化运行事件通过 `logs.service` 写入，失败不能改变评估业务状态。
- `jobs` 只做编排，指标算法保持纯函数。

为遵守现有依赖方向，需在根 `AGENTS.md`/架构文档中补充：

```text
evaluations -> agents, knowledge, retrieval, model_providers, logs
jobs -> evaluations
```

## 8. 数据模型

沿用总方案五张核心表，并补充实现约束。

### 8.1 `evaluation_datasets`

- 增加 `workspace_id`，所有唯一约束必须包含工作空间。
- 名称建议使用 `(workspace_id, normalized_name)` 唯一约束。
- 归档后禁止创建运行，但历史运行仍可查看。

### 8.2 `evaluation_dataset_versions`

- `(dataset_id, version)` 唯一。
- 每个数据集最多一个 Draft：条件唯一索引可由数据库部分索引实现；若 Prisma 无法表达，迁移中写原始 SQL。
- `case_count` 是冗余快照，只能在同一事务中随用例变化更新。
- `frozen_at` 一旦设置不可清空。

### 8.3 `evaluation_cases`

- `question_hash` 用于同版本内去重，计算前先规范化空白。
- `expected_document_ids`、`expected_chunk_ids` 首版可用 UUID 数组；运行时必须通过 Knowledge Service 校验归属和可访问性。
- `metadata` 只允许白名单字段，禁止直接持久化上传文件的任意对象。
- Draft 用例可修改和删除；Frozen 用例任何写接口均返回冲突错误。

### 8.4 `evaluation_runs`

建议增加：

- `workspace_id`。
- `total_cases`、`completed_cases`、`failed_cases`、`skipped_cases`。
- `metrics_version`。
- `snapshot_hash`。
- `cancel_requested_at`。
- `heartbeat_at`，用于识别失联 Job。
- `error_type`、`error_message`，错误信息必须脱敏。
- `updated_at`，支持安全轮询。

创建运行时保存完整快照，而不是只引用 Agent 当前配置。快照禁止 API Key、Authorization Header、加密密文和内部连接串。

### 8.5 `evaluation_case_results`

- `(run_id, case_id)` 唯一，实现幂等消费。
- 增加 `attempt`、`started_at`、`finished_at`。
- `retrieved_chunks` 保存受控文本、ID、内容哈希、排名和各通道分数。
- 指标 JSON 必须带 `metrics_version`，避免未来算法升级后混合口径。
- 单题错误只保存稳定 `error_type` 和脱敏后的 `error_message`。

## 9. API 设计

统一前缀：`/api/v1/evaluations`。所有接口要求当前工作空间，管理接口限 OWNER/MANAGER。

### 9.1 数据集与版本

```text
GET    /datasets
POST   /datasets
GET    /datasets/:datasetId
PATCH  /datasets/:datasetId
POST   /datasets/:datasetId/archive
POST   /datasets/:datasetId/restore
POST   /datasets/:datasetId/versions
GET    /dataset-versions/:versionId
POST   /dataset-versions/:versionId/cases
PATCH  /dataset-versions/:versionId/cases/:caseId
DELETE /dataset-versions/:versionId/cases/:caseId
POST   /dataset-versions/:versionId/import/preview
POST   /dataset-versions/:versionId/import/commit
POST   /dataset-versions/:versionId/freeze
```

导入预览返回 `import_token`。Token 绑定工作空间、用户、文件哈希、解析结果和短期过期时间；commit 不重新信任客户端提交的预览内容。

冻结接口接受 `expectedRevision`，使用乐观锁防止管理员冻结了另一个人刚修改的版本。

### 9.2 运行

```text
GET  /runs
POST /runs
GET  /runs/statuses?ids=...
GET  /runs/:runId
POST /runs/:runId/cancel
POST /runs/:runId/rerun
GET  /runs/:runId/results
GET  /runs/:runId/metrics
GET  /runs/:runId/compatible-baselines
```

创建运行响应只返回：

```json
{
  "id": "run-id",
  "status": "pending",
  "totalCases": 80,
  "createdAt": "2026-09-21T08:00:00.000Z"
}
```

HTTP 请求不得等待第一个用例完成。

### 9.3 对比

```text
GET /comparisons/compatibility?baselineRunId=...&candidateRunId=...
GET /comparisons?baselineRunId=...&candidateRunId=...
GET /comparisons/results?baselineRunId=...&candidateRunId=...
```

对比摘要 DTO：

```typescript
type EvaluationComparison = {
  baseline: EvaluationRunSummary;
  candidate: EvaluationRunSummary;
  compatibility: {
    compatible: boolean;
    reasons: Array<{
      field: string;
      baselineValue: unknown;
      candidateValue: unknown;
      message: string;
    }>;
  };
  metrics: Array<{
    key: string;
    label: string;
    direction: "higher_is_better" | "lower_is_better";
    baselineValue: number | null;
    candidateValue: number | null;
    absoluteDelta: number | null;
    relativeDelta: number | null;
    sampleCount: number;
    verdict: "improved" | "regressed" | "unchanged" | "not_comparable";
  }>;
  caseCounts: {
    improved: number;
    regressed: number;
    unchanged: number;
    mixed: number;
  };
  gateResult: "passed" | "failed" | "warning" | "not_evaluated";
};
```

## 10. 运行状态机与 Job

```text
pending -> running -> completed
   |          |  \-> failed
   |          \----> canceled
   \---------------> canceled
```

规则：

- 只有 `pending/running` 可请求取消。
- 取消接口只写 `cancel_requested_at`，Job 在安全边界收敛为 `canceled`。
- `completed/failed/canceled` 是终态。
- Job 每完成一题更新计数和 `heartbeat_at`。
- 单题失败不终止整场运行；快照无效、模型配置缺失等系统性错误直接失败。
- Job 启动时用条件更新抢占 `pending`，防止重复消费者并发执行同一运行。
- 单题使用 `(run_id, case_id)` upsert；已完成结果不重复调用模型。

单题执行：

```text
加载冻结 Case
  -> 按运行快照执行检索
  -> 构造与线上一致的 RAG Prompt
  -> 调用被评模型
  -> 计算规则指标
  -> 可选调用 LLM 裁判
  -> 原子保存单题结果并更新进度
```

并发初始值：评估用例 2，裁判 2。必须继续受全局和 Provider 级并发限制。

首版本地部署可使用数据库任务状态 + 进程内 worker，但应用重启后必须扫描 `pending` 和心跳超时的 `running` 任务恢复。后续再按压力决定是否引入独立队列，不提前增加 Redis 依赖。

## 11. 指标计算口径

### 11.1 检索指标

- 相关集合优先使用 `expected_chunk_ids`；为空时退化到 `expected_document_ids`。
- 两者都为空时，HitRate、Recall、MRR 为 `null`，不计入均值分母。
- `HitRate@5`：Top 5 是否至少命中一个相关项。
- `Recall@5`：Top 5 命中相关项数量 / 相关项总数。
- `MRR`：第一个相关项排名倒数。
- 空召回率：选中 Chunk 为空的用例数 / 已执行检索用例数。

### 11.2 回答与引用

- 规则指标先实现空回答、正确拒答、引用对象存在性。
- LLM 指标分别保存 score、passed、reason、evidence、failureType。
- 裁判解析失败时对应指标为 `null`，单题仍可为 completed，但增加 grader warning。
- 不可回答用例不计算普通回答正确性，计算拒答准确率。

### 11.3 聚合

- 均值仅聚合非 null 值，并同时返回 `validCount/nullCount/totalCount`。
- P50/P95 使用确定性分位数算法并锁定 `metrics_version`。
- 失败和超时用例进入运行质量分母，但不把回答语义指标强行记 0。
- 所有金额使用整数最小单位或 Decimal 字符串，禁止用浮点数累计成本。

## 12. Baseline 兼容性

直接对比必须满足：

1. 相同 `dataset_version_id`。
2. 相同 `metrics_version`。
3. 相同裁判 Prompt 版本和裁判模型；未启用裁判的运行只能比较规则指标。
4. 相同用例集合和完成范围。
5. 对比指标在双方都有有效值。

Agent、检索和被评模型配置允许不同，这正是 Candidate 的变量，但必须在报告顶部列出差异。

不兼容运行仍可在两个独立报告间导航，但不得计算 Gate 或显示误导性 Delta。

## 13. Gate 设计

Gate 配置首版由服务端版本化常量管理，不开放任意表达式编辑器：

```typescript
type EvaluationGateRule = {
  id: string;
  metric: string;
  operator: "gte" | "lte" | "delta_gte" | "delta_lte";
  threshold: number;
  severity: "error" | "warning";
  minimumSampleCount?: number;
};
```

没有 Baseline 的绝对规则可以执行；依赖 Delta 的规则返回 `not_evaluated`。每条规则保存实际输入和结论，防止后续规则升级改变历史报告解释。

## 14. 安全与隐私

- 所有查询包含 `workspace_id`。
- 运行创建者只能选择当前空间可访问的 Agent、知识库和模型。
- 快照使用白名单序列化，禁止通用对象递归持久化。
- 数据集导入限制文件大小、行数、字段长度和 MIME；不执行公式和脚本。
- CSV 导出需防止公式注入，以 `= + - @` 开头的单元格进行安全转义。
- 错误消息和裁判详情不得包含 API Key、Authorization、完整请求 Header 或数据库连接信息。
- Chunk 文本遵循知识库敏感快照策略；无权限时只返回 ID、哈希和受控预览。

## 15. 可观测性

标准化事件：

- `evaluation_run_created`
- `evaluation_run_started`
- `evaluation_case_completed`
- `evaluation_case_failed`
- `evaluation_run_cancel_requested`
- `evaluation_run_completed`
- `evaluation_run_failed`
- `evaluation_run_canceled`

日志字段包含 `request_id`、`run_id`、可选 `case_id`、`workspace_id`、耗时和错误类型。不要为每个 Token 写事件。

运行列表需要暴露：排队时长、完成速率、预计剩余时间、最后心跳、模型/裁判错误计数。

## 16. 错误与恢复

| 场景             | 行为                                   |
| ---------------- | -------------------------------------- |
| Draft 被并发修改 | 返回 409 和当前 revision，前端要求刷新 |
| 冻结版本写入     | 返回 409，提示复制新 Draft             |
| Provider 429     | 按模型调用规范退避；单题保留尝试次数   |
| 单题超时         | 标记该题 failed/timeout，继续后续用例  |
| 裁判解析失败     | 指标 null + warning，不丢弃被评回答    |
| Worker 重启      | 通过心跳和幂等结果恢复                 |
| 用户取消         | 停止未开始用例，取消正在执行的上游调用 |
| Baseline 不兼容  | 返回结构化原因，不生成 Delta/Gate      |

## 17. 测试方案

### 17.1 纯函数单测

- HitRate、Recall、MRR、分位数和 null 聚合。
- 正向/负向指标 Delta 与 verdict。
- Baseline 为 0 时相对变化。
- Gate 的绝对规则、Delta 规则和小样本跳过。
- CSV/JSONL 解析、去重、错误行定位和公式注入转义。
- 快照白名单和敏感字段过滤。

### 17.2 Service 测试

- 一个数据集只允许一个 Draft。
- Frozen 后所有写操作被拒绝。
- 创建运行只接受 Frozen 版本。
- 运行快照不包含密钥。
- 重复 Job 消费不重复执行已完成 Case。
- 单题失败后其他 Case 继续。
- 取消传播到 Retrieval 和 Model Provider。
- 不兼容运行拒绝比较。
- 工作空间隔离和 OWNER/MANAGER 权限。

### 17.3 前端测试

- `null` 指标显示 `—/未启用`，不显示 0。
- 运行进入终态后停止轮询。
- 页面隐藏时轮询退避。
- 旧 runId 响应不覆盖新页面状态。
- Frozen 版本编辑入口禁用且原因可见。
- 对比页负向指标正确标注“越低越好”。
- 表格键盘操作、焦点、错误提示和图表数据表替代。

### 17.4 集成验收

1. 导入至少 50 条用例并冻结 v1。
2. 基于同一 v1 创建 Baseline 和 Candidate。
3. 两次运行可在服务重启后继续或安全恢复。
4. 报告分层显示检索、回答、引用、运行指标和有效样本数。
5. 对比页准确列出改善、退化、混合和不变用例。
6. 单题可以下钻到召回、回答、引用和裁判证据。
7. 普通 MEMBER 无法访问页面和 API。

## 18. 实施顺序

### 里程碑 1：数据集

- Prisma 表与迁移。
- Dataset/Version/Case Service 与 API。
- CSV/JSONL 预览和提交。
- 数据集列表、详情、用例抽屉和冻结交互。

### 里程碑 2：基础运行

- Run/CaseResult 表与状态机。
- 本地 worker、恢复、取消和幂等。
- Retrieval 评估稳定接口。
- 规则指标和运行列表/进度。

### 里程碑 3：报告与基础对比

- 指标聚合和报告 DTO。
- 报告页、单题下钻。
- 兼容性检查、Delta 和回归列表。
- 软 Gate 报告。

### 里程碑 4：LLM 裁判

- 独立裁判配额、结构化输出和版本化 Prompt。
- 正确性、忠实度、相关性和引用支持度。
- 人工抽检字段与一致率统计。

## 19. 完成定义

功能完成必须同时满足：

- 同一冻结数据集能够产生两次可复现运行。
- 运行中断、重复消费和用户取消不会产生重复结果或继续无界消耗模型。
- 报告的每个指标都有口径、方向、有效样本数和版本。
- Baseline/Candidate 不兼容时不会显示伪 Delta。
- 管理员可从汇总指标下钻到造成退化的具体问题、召回和回答。
- 页面支持稳定 URL、刷新恢复、空状态、错误恢复和键盘访问。
- 不泄露 Provider 密钥、连接信息或越权知识库内容。
