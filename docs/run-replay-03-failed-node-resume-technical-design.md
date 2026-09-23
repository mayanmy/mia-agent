# Run 重放技术方案（三）：失败节点恢复

## 1. 方案定位

本方案允许失败或超时的 Workflow Run 从失败节点创建一个新的恢复 Run，复用已经完成且允许复用的上游检查点。

```text
source run: Start ✓ -> Retrieval ✓ -> Tool ✓ -> LLM ✗
resume run: [复用 Start/Retrieval/Tool] -> LLM -> End
```

恢复始终创建新 Run，不把旧 Run 从 `FAILED` 改回 `RUNNING`。

## 2. 前置条件

必须先完成：

1. 方案一的派生 Run 关系和幂等创建。
2. 方案二的执行快照、固定 Workflow Version 和节点检查点。
3. 源 Run 的失败节点具有稳定 `nodeId`。
4. 从 Start 到失败节点的实际分支路径可以由检查点还原。

## 3. 目标与限制

### 3.1 目标

- 自动定位失败节点。
- 预检哪些节点复用、重跑、需要确认或阻断。
- 重建 Workflow Context。
- 从失败节点重新执行。
- 新 Run Trace 显示复用节点和本次实际执行节点。
- 保证副作用节点不会无提示地重复执行。

### 3.2 限制

- 首期只支持串行 DAG Workflow。
- 不支持普通 Agent Tool Loop 的中间轮次恢复。
- 不支持没有检查点的历史 Run。
- 不支持恢复到已经变化的 Workflow Version。
- 不支持并行分支和循环节点；未来需要额外的调度检查点。

## 4. 数据模型

AgentRun 增加：

```prisma
resumeOfRunId   String? @map("resume_of_run_id") @db.Uuid
resumeFromNodeId String? @map("resume_from_node_id")
```

派生 Run：

```text
replayMode = FAILED_NODE
resumeOfRunId = sourceRunId
rootRunId = source.rootRunId ?? source.id
resumeFromNodeId = failedNodeId
```

新 Run Step 对复用节点写 `SKIPPED`，并增加：

```prisma
reusedFromStepId String? @map("reused_from_step_id") @db.Uuid
```

`SKIPPED + reusedFromStepId` 表示“使用旧检查点”，不能与普通条件跳过混淆。后续可把状态扩展为 `REUSED`；首期用字段区分可减少枚举迁移。

## 5. 恢复预检

### 5.1 定位失败点

按以下优先级：

1. 失败 Run 中最后一个 `FAILED` Step 的 `nodeId`。
2. `TIMED_OUT` Run 中活动 Step 的 `nodeId`。
3. Run `errorType` 中明确记录的节点 ID。

找不到唯一节点时返回 `run_resume_point_ambiguous`，不猜测。

### 5.2 重建实际路径

不能只使用拓扑排序。Condition 可能只执行某个分支，必须根据检查点的 `nextHandle/nextNodeId` 重建：

```text
Start checkpoint.nextNodeId
  -> node checkpoint.nextNodeId
  -> ...
  -> failedNodeId
```

路径中出现断点、环、未知节点或 checksum 不一致时阻断恢复。

### 5.3 节点分类

```text
已完成 + REUSE                  -> 复用
已完成 + REEXECUTE              -> 从该节点提前重跑
已完成 + REQUIRE_CONFIRMATION   -> 等待用户确认
已完成 + FORBIDDEN              -> 阻断
失败节点及其后续                -> 重跑
未走过的其他分支                -> 不进入 Context
```

真正的执行起点是路径中第一个必须重跑的节点，不一定是原失败节点。

## 6. API 设计

### 6.1 恢复预览

```http
POST /api/v1/agent-runs/{runId}/resume-preview
```

响应：

```json
{
  "resumable": true,
  "failedNodeId": "answer",
  "effectiveStartNodeId": "answer",
  "reusedNodes": ["start", "retrieval"],
  "rerunNodes": ["answer", "end"],
  "confirmationNodes": [],
  "blockedNodes": [],
  "resourceDrifts": []
}
```

### 6.2 创建恢复 Run

```http
POST /api/v1/agent-runs/{runId}/resume
X-Idempotency-Key: <uuid>

{
  "previewToken": "signed-short-lived-token",
  "confirmNodeIds": []
}
```

`previewToken` 绑定源 Run、版本、检查点 Hash、预检结果和 5 分钟有效期，防止预检后数据变化。

## 7. Runtime 改造

`WorkflowRunRequest` 增加：

```typescript
type WorkflowResumeState = {
  sourceRunId: string;
  startNodeId: string;
  restoredNodes: Record<string, { output: Record<string, unknown> }>;
  restoredPath: Array<{
    nodeId: string;
    nextHandle?: string;
    nextNodeId?: string;
    sourceStepId: string;
  }>;
};
```

`WorkflowRuntimeService` 调整：

```text
加载固定 Compiled Plan
  -> 校验 resumeState 的 nodeId 都存在
  -> 校验 restoredPath 连续
  -> 注入 context.nodes
  -> 为复用节点产生 node_reused 事件
  -> currentNodeId = startNodeId
  -> 执行现有节点循环
```

新增运行时事件：

```typescript
{ type: "node_reused", data: { nodeId, sourceRunId, sourceStepId } }
```

Agent Runtime 将其写成新 Run 的 `SKIPPED + reusedFromStepId` Step，UI 才能展示完整时间线。

## 8. Context 重建

恢复 Context 包含：

```typescript
{
  input: sourceSnapshot.input,
  nodes: reusedCheckpointOutputs,
  runtime: {
    requestId: newRequestId,
    runId: newRunId,
    sourceRunId,
    resumed: true
  }
}
```

必须使用新 Run 的 `requestId/runId`，不能复用旧追踪 ID。表达式中的业务输入和节点输出复用，运行身份重新生成。

## 9. 事务与并发

创建恢复 Run 时事务内完成：

1. 锁定源 Run 快照版本。
2. 校验源 Run 终态。
3. 校验没有相同幂等 Key 的派生 Run。
4. 创建新 Run 和执行快照。
5. 写入复用关系清单。

同一个源 Run可以创建多个独立恢复 Run，但每个请求 Key 只能创建一个。UI 默认在已有活动恢复 Run 时提示，不强行阻断管理员并行调试。

## 10. 取消、失败与审批

- 恢复 Run 使用自己的 AbortController。
- 取消恢复 Run 不影响源 Run。
- 恢复节点再次失败时可以继续创建下一代恢复 Run。
- 源 Run 处于 `WAITING_APPROVAL` 时不走本方案，继续使用现有 `resumeAfterApproval` 恢复同一个 Run。
- `WAITING_APPROVAL` 与“进程中断后恢复”是不同生命周期，不能混用 API。

## 11. 测试与验收

必须覆盖：

1. 从失败 LLM 节点恢复并复用上游纯节点。
2. Condition 实际分支正确还原，未执行分支不注入 Context。
3. 上游节点要求重跑时有效起点前移。
4. 检查点 Hash、Plan checksum 不一致时阻断。
5. 恢复 Run 使用新的 Run/request ID。
6. 复用 Step 能追溯源 Step。
7. 二次恢复链保持正确 root Run。
8. 源 Run 不被修改。
9. 取消恢复不影响源 Run。
10. `WAITING_APPROVAL` 不错误进入断点恢复。

验收标准：一次可重试节点失败后，管理员能看到预检清单并创建新的恢复 Run，已复用节点不再调用外部服务。
