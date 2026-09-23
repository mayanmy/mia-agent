# Run 重放技术方案（二）：执行快照与版本固定

## 1. 方案定位

本方案把“可以重新跑”升级为“能够说明重新跑的到底是什么”。它固定 Workflow Version、执行输入、运行参数、资源指纹和节点权威输出，为失败节点恢复提供可靠检查点。

本方案是方案三、四、五的前置条件。

## 2. 核心原则

1. 排障 Trace 与执行检查点分开保存。
2. `inputPreview`、Step `input/output` 继续用于展示，不能用于恢复。
3. 每个可恢复 Run 必须绑定不可变 Workflow Version 和 Plan checksum。
4. 快照必须版本化、可校验、可过期、可安全清理。
5. 不快照第三方密钥和 SDK 对象。
6. 大附件保存引用，不写入 JSONB。

## 3. 为什么不能直接复用现有 Step

现有 `AgentRunsService` 会：

- 递归脱敏敏感字段。
- 截断长字符串。
- 限制 Trace JSON 体积。
- 把超大对象转换为 Preview。

这些行为适合排障，但恢复需要完整、结构稳定的节点输出。二者复用同一字段会造成“页面可看，但恢复数据已经残缺”的隐蔽故障。

## 4. 数据模型

### 4.1 Run 执行快照

```prisma
model AgentRunExecutionSnapshot {
  id                 String   @id @default(uuid()) @db.Uuid
  workspaceId        String   @map("workspace_id") @db.Uuid
  runId              String   @unique @map("run_id") @db.Uuid
  schemaVersion      Int      @map("schema_version")
  workflowVersionId  String?  @map("workflow_version_id") @db.Uuid
  planChecksum       String?  @map("plan_checksum")
  input              Json     @db.JsonB
  runtimeConfig      Json     @map("runtime_config") @db.JsonB
  resourceSnapshot   Json     @map("resource_snapshot") @db.JsonB
  contentHash        String   @map("content_hash")
  resumable          Boolean  @default(false)
  expiresAt          DateTime @map("expires_at") @db.Timestamptz(6)
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  run                AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([workspaceId, expiresAt], map: "idx_run_execution_snapshots_expiry")
  @@map("agent_run_execution_snapshots")
}
```

### 4.2 节点检查点

```prisma
model AgentRunStepCheckpoint {
  id                 String       @id @default(uuid()) @db.Uuid
  workspaceId        String       @map("workspace_id") @db.Uuid
  runId              String       @map("run_id") @db.Uuid
  stepId             String       @unique @map("step_id") @db.Uuid
  nodeId             String       @map("node_id")
  attempt            Int
  schemaVersion      Int          @map("schema_version")
  status             String
  resolvedInput      Json         @map("resolved_input") @db.JsonB
  output             Json?        @db.JsonB
  nextHandle         String?      @map("next_handle")
  nextNodeId         String?      @map("next_node_id")
  contextHash        String       @map("context_hash")
  contentHash        String       @map("content_hash")
  replayPolicy       String       @map("replay_policy")
  createdAt          DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)

  @@unique([runId, nodeId, attempt], map: "uq_run_checkpoint_node_attempt")
  @@index([workspaceId, runId, nodeId], map: "idx_run_checkpoints_lookup")
  @@map("agent_run_step_checkpoints")
}
```

检查点表由 `agent_runs` 模块拥有。Workflow Runtime 通过 `AgentRunsService` 写入，不能直接访问表。

## 5. 快照内容

### 5.1 Runtime 快照

```typescript
type RunExecutionSnapshotV1 = {
  schemaVersion: 1;
  input: Record<string, unknown>;
  runtime: {
    agentId?: string;
    workflowId?: string;
    workflowVersionId?: string;
    workflowRunMode?: "PUBLISHED";
    modelConfigIds: string[];
    knowledgeBaseIds: string[];
    toolIds: string[];
    generationParams?: Record<string, number | string | boolean>;
  };
  resources: Record<string, { id: string; fingerprint: string }>;
};
```

`runtimeConfig` 只保存稳定 ID 和非敏感运行参数。模型 API Key、OAuth Token、工具动态令牌在恢复时从所属模块重新解析。

### 5.2 节点检查点

```typescript
type StepCheckpointV1 = {
  schemaVersion: 1;
  nodeId: string;
  nodeType: string;
  attempt: number;
  resolvedInput: Record<string, unknown>;
  output?: Record<string, unknown>;
  nextHandle?: string;
  nextNodeId?: string;
  contextHash: string;
  replayPolicy: "REUSE" | "REEXECUTE" | "REQUIRE_CONFIRMATION" | "FORBIDDEN";
};
```

## 6. 一致性边界

### 6.1 Run 创建

Run 和执行快照必须在同一数据库事务中创建：

```text
create AgentRun(QUEUED)
create AgentRunExecutionSnapshot
commit
dispatch runtime
```

快照创建失败时不能启动 Runtime。

### 6.2 Step 完成

Step Trace 完成和检查点写入使用同一事务：

```text
update AgentRunStep -> COMPLETED
insert AgentRunStepCheckpoint
commit
emit node_completed
```

不能先通知下游节点，再异步保存检查点，否则进程崩溃时会出现下游已执行但上游无可恢复输出。

### 6.3 Hash

`contentHash` 使用规范化 JSON 后的 SHA-256：

```text
sha256(schemaVersion + canonicalJson(payload))
```

恢复时重新计算；不一致则返回 `run_checkpoint_corrupted`。

## 7. Workflow Version 固定

可恢复 Workflow Run 必须保存：

```text
workflow_id
workflow_version_id
compiled_plan.schemaVersion
workflow_version.checksum
resource_fingerprints
```

恢复只调用：

```typescript
getPublishedRuntimeConfig(workflowId, workflowVersionId);
```

不能改为读取“当前已发布版本”。如果原版本被逻辑取消发布，仍允许管理员在保留期内读取不可变版本；如果版本已物理删除，则 Run 不可恢复。

## 8. 资源漂移策略

Workflow Version 固定了图和节点配置，但外部资源可能变化：

| 资源                  | 默认策略                                      |
| --------------------- | --------------------------------------------- |
| Workflow Tool Version | 固定版本                                      |
| Agent Prompt/绑定     | 使用快照中的稳定配置                          |
| 模型配置              | 固定 ID，密钥按当前安全配置读取               |
| 知识库                | 固定知识库 ID，检索结果是否复用由节点策略决定 |
| HTTP 外部数据         | 不承诺稳定，由重放策略决定                    |

预检比较 `resourceFingerprints`。漂移结果分为：

- `UNCHANGED`：可以继续。
- `CHANGED_REEXECUTABLE`：允许重新执行但提示差异。
- `MISSING`：阻断恢复。
- `SECRET_ROTATED`：允许使用当前密钥，不记录旧密钥。

## 9. 快照体积与安全

建议限制：

```text
Run input JSON:       256KB
单节点 input:         256KB
单节点 output:          1MB
单 Run checkpoints:     5MB
```

超过限制：

- 可恢复业务数据写对象存储，JSONB 保存带校验和的引用。
- 无法安全外置时把 `resumable=false`，Run 仍正常执行。
- 不能静默截断后继续标记可恢复。

敏感字段处理：

- Secret 永不快照。
- PII 根据部署策略选择加密或禁止持久化。
- 快照查询接口默认不返回完整内容，只返回摘要和可恢复状态。
- 快照保留时间建议 30 天，短于普通 Run Trace。

## 10. Service 接口

`AgentRunsService` 新增：

```typescript
createRunWithSnapshot(payload): Promise<AgentRunContext>
completeStepWithCheckpoint(stepId, checkpoint): Promise<void>
getExecutionSnapshot(runId): Promise<RunExecutionSnapshotDto>
listCompletedCheckpoints(runId): Promise<StepCheckpointDto[]>
validateReplaySnapshot(runId): Promise<SnapshotValidationResult>
```

所有方法内部强制 Workspace 条件，跨 Workspace 统一返回 404。

## 11. 兼容与迁移

历史 Run 没有快照：

- 仍可查看 Trace。
- `resumable=false`。
- 完整重放和断点恢复按钮禁用。
- 不尝试从 `inputPreview` 或 Step Trace 推导快照。

方案一写入 `AgentRun.inputSnapshot` 的 Run 属于可迁移历史数据：只有通过 schema 校验和内容 Hash 校验后才能回填到 `AgentRunExecutionSnapshot`；回填成功后独立快照表成为唯一权威来源，旧字段进入只读兼容期并在后续迁移删除。

新字段和表先以可空方式上线；Runtime 写入稳定后，再要求新的 Workflow Run 必须有执行快照。

## 12. 测试与验收

必须覆盖：

1. Run 与快照事务一致。
2. Step 终态与检查点事务一致。
3. Hash 校验能发现篡改和损坏。
4. Secret、附件正文不进入 JSONB。
5. 超过体积限制时不会生成残缺检查点。
6. 原 Workflow Version 和 checksum 正确固定。
7. 资源漂移分类稳定。
8. 历史 Run 保持可读但不可恢复。
9. 清理任务先删除到期快照，不影响 Run Trace。

验收标准：任意新 Workflow Run 都能明确回答“使用了哪个版本、什么输入、哪些资源和哪些完整节点输出”，并可靠判断是否可恢复。
