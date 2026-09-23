# Run 重放技术方案（一）：完整重放

## 1. 方案定位

本方案实现五阶段中的第一步：从历史 Run 创建一个全新的 Run，并从入口完整执行一次。

```text
source run
  -> 读取原始执行输入
  -> 固定原执行对象
  -> 创建 replay run
  -> 从 Start 重新执行
```

本阶段不跳过已成功节点、不复用节点输出，也不修改原 Run。它解决“快速复现失败”和“用相同输入再跑一次”的最小闭环。

## 2. 目标与非目标

### 2.1 目标

1. 管理员可以在 Run Trace 详情页发起完整重放。
2. 每次重放创建新的 `run_id`，原 Run 保持不可变。
3. 新 Run 记录来源 Run、根 Run、发起人和重放模式。
4. 默认使用原 Workflow Version；没有可靠原始输入时拒绝重放。
5. 防止重复点击创建多个相同的重放任务。
6. 重放仍走统一 Runtime、超时、取消、日志和权限链路。

### 2.2 非目标

- 不从失败节点继续。
- 不复用旧 Step 输出。
- 不允许选择任意节点。
- 不自动重放具有副作用的旧工具结果；完整重放会重新执行全部节点，风险由预检明确提示。
- 不使用 `inputPreview` 作为执行输入。

## 3. 当前差距

现有 `AgentRun` 已保存 `workflowId`、`workflowVersionId` 和 `inputPreview`，但 `inputPreview` 是脱敏截断文本，无法用于执行。完整重放至少需要一个可 JSON 序列化的权威输入快照。

M1 只增加“Run 入口输入”最小快照；更完整的运行配置和节点检查点在方案二建设。

## 4. 数据设计

### 4.1 枚举

```prisma
enum AgentRunReplayMode {
  FULL
  FAILED_NODE
  FROM_NODE

  @@map("agent_run_replay_mode")
}
```

### 4.2 AgentRun 扩展

```prisma
model AgentRun {
  replayOfRunId String?             @map("replay_of_run_id") @db.Uuid
  rootRunId     String?             @map("root_run_id") @db.Uuid
  replayMode    AgentRunReplayMode? @map("replay_mode")
  replayedById  String?             @map("replayed_by_id") @db.Uuid
  inputSnapshot Json?               @map("input_snapshot") @db.JsonB

  @@index([replayOfRunId, createdAt(sort: Desc)], map: "idx_agent_runs_replay_of")
  @@index([rootRunId, createdAt(sort: Desc)], map: "idx_agent_runs_root")
}
```

字段语义：

- `replayOfRunId`：直接来源 Run。
- `rootRunId`：整条重放链最初的 Run，便于聚合。
- `replayMode`：本阶段固定为 `FULL`。
- `replayedById`：发起重放的内部成员。
- `inputSnapshot`：执行所需的最小输入，不是展示 Preview。

附件正文不直接写 JSONB。图片、文件只保存受控对象存储引用或已存在的文件 ID。不能把 Data URL 写进 Run 表。

`inputSnapshot` 是 M1 的过渡字段。方案二上线独立 `AgentRunExecutionSnapshot` 后，应事务性回填可识别数据并停止写入该字段，避免长期维护两份权威输入。

### 4.3 防重复请求

新增请求表或在 Run 上增加：

```prisma
replayRequestKey String? @map("replay_request_key")

@@unique([workspaceId, replayRequestKey], map: "uq_agent_runs_replay_request")
```

客户端每次点击生成 UUID，通过 `X-Idempotency-Key` 传入。相同 Workspace、相同 Key 返回已经创建的新 Run。

## 5. 模块边界

```text
AgentRunReplayController（agent_runtime）
  -> RunReplayService（agent_runtime）
       -> AgentRunsService：读取源 Run、创建派生 Run
       -> AgentsService：读取 Agent Runtime 配置
       -> WorkflowRuntimeService：执行固定 Workflow Version
       -> AgentRuntimeService：执行普通 Agent Run
```

`agent_runs` 继续独占 Run 表读写。`RunReplayService` 只做跨模块编排，不能直接使用 Prisma。

Replay Controller 放在 `agent_runtime`，避免形成：

```text
agent_runs -> agent_runtime -> agent_runs
```

HTTP 路径仍使用 `/api/v1/agent-runs/...`，路由前缀不决定模块归属。

## 6. API 设计

### 6.1 重放预检

```http
POST /api/v1/agent-runs/{runId}/replay-preview

{
  "versionMode": "ORIGINAL"
}
```

响应：

```json
{
  "replayable": true,
  "sourceRunId": "run-1",
  "workflowVersionId": "version-1",
  "warnings": ["将重新执行 1 个外部工具节点"],
  "blockers": []
}
```

### 6.2 创建完整重放

```http
POST /api/v1/agent-runs/{runId}/replay
X-Idempotency-Key: 08a49db5-...

{
  "versionMode": "ORIGINAL"
}
```

响应使用 `202 Accepted`：

```json
{
  "runId": "run-2",
  "sourceRunId": "run-1",
  "rootRunId": "run-1",
  "mode": "FULL",
  "status": "QUEUED"
}
```

首期只支持 `ORIGINAL`。使用最新版本属于对比实验，不能与“原样重放”混为一谈，可在后续增加 `LATEST`。

## 7. 执行流程

```text
校验 OWNER/MANAGER 权限
  -> AgentRunsService.getReplaySource
  -> 校验源 Run 已进入终态
  -> 校验 inputSnapshot 存在且 schema 可识别
  -> 校验原 Agent/Workflow Version 仍可读取
  -> 执行副作用预检
  -> 事务创建 QUEUED replay run
  -> 提交后台执行任务
  -> Runtime 从入口完整执行
  -> 正常写入新 Run/Step
```

源 Run 允许状态：`COMPLETED`、`FAILED`、`CANCELED`、`TIMED_OUT`。`RUNNING`、`QUEUED` 和 `WAITING_APPROVAL` 禁止重放。

## 8. 输入快照规则

首期建议：

```typescript
type RunInputSnapshotV1 = {
  schemaVersion: 1;
  input: Record<string, unknown>;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachmentRefs?: Array<{ fileId: string; name: string; mimeType: string }>;
};
```

约束：

- 最大 JSON 体积 256KB。
- 敏感字段按现有 Run Trace 规则拒绝或脱敏。
- 密码、API Key、Authorization 不进入快照。
- 外部匿名访问密码不得持久化；公开 Widget Run 首期不开放重放。
- 输入快照缺失时返回 `run_replay_snapshot_missing`，不能回退到 Preview。

## 9. 状态和错误

新错误类型：

```text
run_replay_not_allowed
run_replay_snapshot_missing
run_replay_version_unavailable
run_replay_side_effect_confirmation_required
run_replay_request_conflict
```

后台任务启动失败时，新 Run 从 `QUEUED` 进入 `FAILED`，错误类型为 `replay_dispatch_failed`，不能删除新 Run。

## 10. 前端设计

Run 详情页增加：

- “完整重放”按钮。
- 预检确认弹窗。
- 原版本、节点数、工具副作用提示。
- 创建成功后跳转新 Run Trace。
- 新 Run 顶部展示“重放自 run-1”。

按钮只对允许状态显示；最终权限仍由服务端判断。

## 11. 测试与验收

必须覆盖：

1. 相同输入和原 Workflow Version 创建新 Run。
2. 原 Run 不被修改。
3. 重放链正确维护 `replayOfRunId/rootRunId`。
4. 缺失输入快照时拒绝执行。
5. 非终态 Run 拒绝重放。
6. 跨 Workspace Run 返回 404。
7. 相同幂等 Key 只创建一个 Run。
8. 后台派发失败形成可排查的 FAILED Run。
9. 原版本不存在或不可用时返回稳定错误。

验收标准：管理员可以从一次失败 Workflow Run 创建完整重放，新 Run 独立执行并保留清晰来源关系。

## 12. 实施顺序

1. Prisma 字段和迁移。
2. 输入快照 DTO 与写入。
3. `AgentRunsService` 派生 Run 接口。
4. `RunReplayService` 与 Controller。
5. 异步派发和幂等处理。
6. Run Trace 前端入口。
7. 单元测试、集成测试和迁移回滚验证。
