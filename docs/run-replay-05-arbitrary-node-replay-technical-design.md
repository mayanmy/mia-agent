# Run 重放技术方案（五）：从任意节点重放

## 1. 方案定位

本方案允许管理员在 Run Trace 中选择任意 Workflow 节点，预览依赖和副作用后，从该节点创建新的重放 Run。

它是五阶段的最终能力，依赖：

- 完整重放的派生 Run 模型。
- 权威执行快照和固定 Workflow Version。
- Context 恢复能力。
- 副作用分类、幂等账本和人工确认。

## 2. 使用场景

1. 修改某个节点输入后重新验证下游。
2. 强制重新执行一个已经成功的 LLM 节点。
3. 从 Condition 前重算分支。
4. 从 Retrieval 节点重新获取最新知识。
5. 调试下游节点而复用昂贵的上游模型输出。

本能力面向 OWNER/MANAGER 排障，不作为普通终端用户功能。

## 3. 设计原则

1. 用户选择的是“期望节点”，系统计算“有效起点”。
2. 依赖不完整时必须向上回溯，不能注入缺失变量。
3. Condition 重跑后可能改变路径，旧分支下游检查点全部失效。
4. 任何输入覆盖都创建新 Run 和新快照。
5. 原 Run、原检查点和原副作用账本不可修改。
6. 预检结果必须签名并短期有效。

## 4. 支持范围

首期支持当前串行 DAG 节点：

```text
start
template
condition
retrieval
llm
tool
end
```

暂不支持：

- 并行 Join。
- 循环和动态子图。
- Subagent 的内部节点。
- 没有稳定 `nodeId` 的普通 Agent Loop Step。
- 跨 Workflow Version 映射节点。

## 5. 预检算法

### 5.1 输入

```typescript
type ReplayFromNodePreviewDto = {
  nodeId: string;
  inputOverrides?: Record<string, unknown>;
  nodePolicies?: Record<string, "REUSE" | "REEXECUTE">;
};
```

### 5.2 依赖分析

Compiled Plan 的节点配置已经包含静态 `CompiledReference`。预检器提取：

```text
node config
  -> input.* 引用
  -> nodes.{nodeId}.output.* 引用
  -> 建立数据依赖边
```

控制流依赖来自 `outgoingEdges`，数据依赖来自 `CompiledReference`。二者都满足时节点才可执行。

### 5.3 有效起点计算

```text
targetNode = 用户选择节点
requiredOutputs = targetNode 的上游数据依赖

对每个 requiredOutput：
  有完整检查点 + REUSE -> 注入 Context
  无检查点 / Hash 无效 -> 向上回溯到生产节点
  REEXECUTE -> 向上回溯到该节点
  REQUIRE_CONFIRMATION -> 加入确认清单
  FORBIDDEN -> 加入阻断清单

effectiveStartNode = 实际路径中最早必须重跑的节点
```

对于 Condition：

- Condition 被复用时沿用旧 `nextHandle`。
- Condition 被重跑时，从该节点之后不复用旧控制流路径。
- 新分支执行到未曾执行的节点时按正常 Runtime 执行。

### 5.4 预检输出

```typescript
type ReplayFromNodePreview = {
  sourceRunId: string;
  requestedNodeId: string;
  effectiveStartNodeId: string;
  reusedNodes: string[];
  rerunNodes: string[];
  invalidatedNodes: string[];
  confirmationNodes: ReplayConfirmationNode[];
  blockedNodes: ReplayBlockedNode[];
  estimatedAdditionalCalls: {
    model: number;
    retrieval: number;
    tool: number;
  };
  previewToken?: string;
};
```

## 6. 输入覆盖

首期只允许覆盖：

- Workflow `input.*`。
- 目标节点配置中显式声明为可调试的参数。

禁止覆盖：

- `runtime.runId/requestId`。
- 节点历史输出。
- Workflow Version ID。
- Tool ID、模型密钥、访问密码。
- 未在 schema 中声明的任意 JSON 路径。

输入覆盖通过 Workflow 输入 schema 校验，并写入新 Run 的执行快照。UI 不能直接提交 JSON Patch 修改任意 Context。

## 7. API 设计

### 7.1 任意节点预检

```http
POST /api/v1/agent-runs/{runId}/replay-from-node-preview

{
  "nodeId": "answer",
  "inputOverrides": {
    "question": "新的调试问题"
  }
}
```

### 7.2 创建重放

```http
POST /api/v1/agent-runs/{runId}/replay-from-node
X-Idempotency-Key: <uuid>

{
  "previewToken": "signed-preview",
  "confirmations": []
}
```

响应：

```json
{
  "runId": "run-new",
  "sourceRunId": "run-old",
  "requestedNodeId": "answer",
  "effectiveStartNodeId": "retrieval",
  "mode": "FROM_NODE",
  "status": "QUEUED"
}
```

## 8. Preview Token

Token 至少绑定：

```text
workspace_id
operator_user_id
source_run_id
source_snapshot_hash
workflow_version_id
plan_checksum
requested_node_id
effective_start_node_id
input_overrides_hash
reuse/rerun/confirmation decision hash
expires_at
```

创建接口重新校验签名、操作者和过期时间。任何字段不一致都要求重新预检。

## 9. Runtime 执行

复用方案三的 `WorkflowResumeState`，扩展：

```typescript
type WorkflowReplayState = WorkflowResumeState & {
  mode: "FROM_NODE";
  requestedNodeId: string;
  inputOverrides: Record<string, unknown>;
  invalidatedNodeIds: string[];
};
```

执行步骤：

```text
加载固定 Plan
  -> 创建新 Context(input + overrides)
  -> 注入允许复用的 checkpoints
  -> 记录 node_reused Steps
  -> 从 effectiveStartNodeId 执行
  -> Condition 产生新的 nextHandle
  -> 沿新路径继续到 End
```

## 10. 前端交互

Run Trace 每个有 `nodeId` 的 Step 提供“从此节点重放”。点击后打开 Drawer：

1. 展示目标节点和有效起点。
2. 展示将复用、重跑和失效的节点。
3. 展示模型、检索和工具调用估算。
4. 对允许的 Workflow 输入提供编辑表单。
5. 对副作用节点逐项确认。
6. 有阻断项时禁用提交。

创建成功后打开新 Run，并在时间线标记：

```text
复用自 run-old / step-3
从节点 answer 请求重放
实际从 retrieval 开始
```

## 11. 权限与审计

- 仅 Workspace OWNER/MANAGER。
- 只能操作当前 Workspace Run。
- 每次预检和执行记录操作者。
- 输入覆盖保存脱敏摘要和 Hash。
- 人工副作用确认保存原因。
- Service API 和公开 Widget 首期不暴露此能力。

## 12. 失败处理

| 情况                        | 处理                             |
| --------------------------- | -------------------------------- |
| 目标节点不在固定版本        | 400 `replay_node_not_found`      |
| 缺少上游检查点              | 自动前移有效起点；无法前移则阻断 |
| 原版本不可读取              | 409 `replay_version_unavailable` |
| Preview Token 过期          | 409，要求重新预检                |
| 资源指纹变化                | 根据方案二分类提示或阻断         |
| 副作用状态 UNKNOWN          | 根据方案四要求人工处理           |
| 新路径进入旧 Run 未执行节点 | 正常执行，不读取不存在的检查点   |

## 13. 测试与验收

必须覆盖：

1. 从纯节点重放并正确复用所有安全上游。
2. 缺少依赖输出时有效起点自动前移。
3. 数据依赖和控制流依赖同时校验。
4. 重跑 Condition 后旧分支检查点失效。
5. 新分支节点正常执行。
6. 输入覆盖通过 schema 校验并进入新快照。
7. 禁止覆盖敏感和 Runtime 字段。
8. Preview Token 防篡改、过期和跨用户使用。
9. 副作用确认与账本正确联动。
10. 原 Run 和检查点保持不可变。
11. 新 Run Timeline 正确展示复用来源。
12. 并发点击通过幂等 Key 只创建一次。

验收标准：管理员能够从任意受支持节点发起预检，系统准确计算有效起点和风险，并创建可审计的新 Run；任何依赖不完整或副作用不确定的情况都不会静默执行。

## 14. 五阶段完成后的能力边界

```text
完整重放       -> 从入口重新执行
失败节点恢复   -> 自动从安全的最晚检查点继续
任意节点重放   -> 管理员选择目标，系统计算安全起点
```

三种操作都遵循同一底线：旧 Run 不修改、派生 Run 使用新身份、固定原版本、副作用默认保守、所有决策可审计。
