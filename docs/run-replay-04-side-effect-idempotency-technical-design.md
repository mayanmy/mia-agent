# Run 重放技术方案（四）：副作用分类与幂等控制

## 1. 方案定位

断点恢复最危险的故障不是“没有恢复”，而是重复创建工单、重复写数据、重复发通知或重复触发部署。本方案为 Tool 和能力节点建立副作用分类、重放策略、幂等键和执行账本。

本方案在开放任意节点重放前必须完成。

## 2. 目标

1. 每个可执行工具声明副作用等级和默认重放策略。
2. 重放预检能够识别可能重复产生副作用的节点。
3. 支持幂等的写操作复用原业务结果或安全重试。
4. 不支持幂等的写操作必须人工确认或禁止自动重放。
5. 工具超时后的“不确定结果”不能被当作失败后直接重试。
6. 所有重放决策形成审计记录。

## 3. 分类模型

### 3.1 副作用等级

```typescript
type ToolSideEffectLevel =
  | "NONE" // 纯计算、格式转换
  | "READ" // 外部读取，结果可能变化
  | "IDEMPOTENT_WRITE" // PUT/Upsert 等可安全重复
  | "NON_IDEMPOTENT_WRITE" // 创建、发送、触发动作
  | "UNKNOWN";
```

### 3.2 重放策略

```typescript
type ReplayPolicy = "REUSE" | "REEXECUTE" | "REQUIRE_CONFIRMATION" | "FORBIDDEN";
```

默认映射：

| 副作用等级           | 默认策略                          |
| -------------------- | --------------------------------- |
| NONE                 | REUSE                             |
| READ                 | REEXECUTE，可由节点配置改成 REUSE |
| IDEMPOTENT_WRITE     | REEXECUTE，但必须有幂等能力       |
| NON_IDEMPOTENT_WRITE | REQUIRE_CONFIRMATION              |
| UNKNOWN              | FORBIDDEN                         |

安全优先级：工具定义策略 < Workflow 节点更严格策略 < 平台强制限制。调用方只能收紧，不能绕过平台禁令。

## 4. 工具定义扩展

内置工具、HTTP Tool、MCP Tool 和 Workflow Tool 的统一运行定义增加：

```typescript
type ToolReplayMetadata = {
  sideEffectLevel: ToolSideEffectLevel;
  replayPolicy: ReplayPolicy;
  idempotency?: {
    supported: boolean;
    transport: "HEADER" | "BODY" | "NATIVE";
    fieldName?: string;
    resultLookupSupported?: boolean;
  };
};
```

规则：

- 内置纯工具显式声明 `NONE`。
- HTTP GET/HEAD 默认 `READ`。
- HTTP POST/PATCH 默认 `UNKNOWN`，管理员必须配置后才能自动重放。
- MCP Tool 没有可靠 annotations 时默认 `UNKNOWN`。
- Workflow Tool 的副作用等级取内部所有可达节点的最高风险。

## 5. 幂等键

### 5.1 逻辑操作 ID

不能用新 Run ID 生成幂等键，否则每次重放都会产生不同键。应基于原始逻辑操作：

```text
logical_operation_id = root_run_id + workflow_version_id + node_id + original_attempt
idempotency_key = HMAC(server_secret, logical_operation_id)
```

后续恢复 Run 执行同一个逻辑节点时沿用该键。

### 5.2 传递方式

- HTTP Tool：配置的 `Idempotency-Key` Header 或 Body 字段。
- 内置工具：在执行上下文中传入，由实现消费。
- MCP Tool：只有工具协议或 schema 明确支持时传入，不能擅自增加参数。
- Workflow Tool：父 Run 的逻辑操作 ID 向子 Run 传播。

幂等键不得展示给普通用户，也不能包含原始用户数据。

## 6. 副作用账本

```prisma
enum RunEffectStatus {
  RESERVED
  IN_PROGRESS
  SUCCEEDED
  FAILED
  UNKNOWN
}

model AgentRunEffect {
  id                 String          @id @default(uuid()) @db.Uuid
  workspaceId        String          @map("workspace_id") @db.Uuid
  logicalOperationId String          @map("logical_operation_id")
  idempotencyKeyHash String          @map("idempotency_key_hash")
  runId              String          @map("run_id") @db.Uuid
  stepId             String          @map("step_id") @db.Uuid
  nodeId             String?         @map("node_id")
  toolId             String          @map("tool_id")
  sideEffectLevel    String          @map("side_effect_level")
  status             RunEffectStatus
  resultCheckpoint   Json?           @map("result_checkpoint") @db.JsonB
  externalReference  String?         @map("external_reference")
  createdAt          DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([workspaceId, logicalOperationId], map: "uq_run_effect_logical_operation")
  @@index([runId, stepId], map: "idx_run_effect_run_step")
  @@map("agent_run_effects")
}
```

表归属 `agent_runs`。Agent Runtime 在调用 ToolsService 前后通过 AgentRunsService 更新账本，保持依赖方向：

```text
agent_runtime -> agent_runs
agent_runtime -> tools
```

禁止 `tools -> agent_runs`。

## 7. 执行协议

```text
计算 logical_operation_id
  -> reserveEffect（唯一约束）
  -> 已有 SUCCEEDED：按策略复用 resultCheckpoint
  -> 已有 IN_PROGRESS：返回冲突，禁止并发重复执行
  -> 已有 UNKNOWN：要求人工处理
  -> 新记录 RESERVED
  -> 标记 IN_PROGRESS
  -> 调用工具并传幂等键
  -> 明确成功：SUCCEEDED + 结果检查点
  -> 明确业务失败：FAILED
  -> 超时/连接断开且无法确认远端状态：UNKNOWN
```

`UNKNOWN` 是必要状态。HTTP 请求超时不代表远端没有完成写操作。

## 8. 重放决策

| 账本状态                  | 重放行为                           |
| ------------------------- | ---------------------------------- |
| SUCCEEDED + 可复用结果    | 直接复用，不调用远端               |
| SUCCEEDED + 必须重新读取  | 使用查询接口确认远端状态           |
| FAILED + 明确未产生副作用 | 允许按策略重试                     |
| IN_PROGRESS               | 阻断并提示仍有执行者               |
| UNKNOWN                   | 阻断自动重放，要求管理员确认或对账 |

人工确认 DTO：

```typescript
type EffectConfirmation = {
  nodeId: string;
  decision: "REUSE_RECORDED" | "REEXECUTE" | "MARK_COMPLETED" | "ABORT";
  reason: string;
};
```

确认记录必须包含操作者、时间、源 Run、新 Run 和原因。

## 9. API 与 UI

恢复预检返回：

```json
{
  "confirmationNodes": [
    {
      "nodeId": "create_ticket",
      "sideEffectLevel": "NON_IDEMPOTENT_WRITE",
      "effectStatus": "UNKNOWN",
      "message": "上次请求超时，无法确认工单是否已创建"
    }
  ]
}
```

Run Trace Tool Step 展示：

- 副作用等级。
- 幂等支持状态。
- 外部引用摘要。
- 执行结果是否确定。
- 重放决策和确认人。

不能向 UI 返回原始幂等键。

## 10. 配置治理

- 新建 HTTP POST Tool 默认 `UNKNOWN/FORBIDDEN`。
- 管理员声明幂等能力时必须填写 Header/Body 字段和使用说明。
- 工具配置更新只影响新 Workflow Version；历史版本保留原策略快照。
- MCP Sync 更新工具 schema 时重新计算风险，但不能自动降低已发布版本的等级。
- 高风险工具必须在发布 Workflow 时给出提示。

## 11. 测试与验收

必须覆盖：

1. 相同逻辑操作生成相同幂等键，不同节点生成不同键。
2. 数据库唯一约束阻止并发重复执行。
3. SUCCEEDED 结果能够安全复用。
4. 超时写操作进入 UNKNOWN，不能自动重试。
5. 非幂等写操作要求人工确认。
6. MCP 未声明副作用时默认禁止。
7. 工具策略只能被收紧，不能被普通调用方放宽。
8. 幂等键和 Secret 不出现在日志、Trace 和 API。
9. Workflow Tool 正确继承最高风险等级。
10. 人工决策形成完整审计记录。

验收标准：任何可能产生外部写入的节点在重放前都有明确风险分类；系统不会因为超时或重复点击静默执行第二次。
