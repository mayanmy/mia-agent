# Workflow 双入口模型技术方案

## 1. 目标

Mia 的 Workflow 同时支持两种消费方式：

1. **独立应用入口**：成员直接填写 Start 节点声明的输入并运行已发布版本，查看最终输出和节点事件。
2. **Agent Tool 入口**：管理员把已发布 Workflow Version 绑定为 Agent 工具，由 Agent 根据用户意图决定是否调用。

两种入口共享同一份不可变 `workflow_versions.compiled_plan` 和 `WorkflowRuntimeService`，避免出现“页面运行正常、Agent 调用行为不同”的双实现。

## 2. 核心模型

```text
Workflow Draft
  -> validate
  -> publish immutable Workflow Version
       -> Workflow App Run
       -> Workflow Tool Definition
            -> AgentTool binding
            -> Agent Runtime tool call
```

Workflow Tool 的稳定 ID 使用：

```text
workflow:<workflow_id>:<workflow_version_id>
```

ID 固定到明确版本。发布新版本不会静默改变已绑定 Agent，管理员需要在 Agent 编辑页主动选择新版本。

## 3. 模块边界

```text
workflows
  - 草稿、发布版本、运行表单 Schema、Workflow Tool Definition

workflow_runtime
  - 执行已发布版本
  - 独立运行 Controller
  - Workflow Tool 执行适配

agents
  - 保存普通工具和 Workflow Tool ID
  - 校验绑定目标仍是有效发布版本

agent_runtime
  - 合并普通 Tool Definition 与 Workflow Tool Definition
  - 根据 tool ID 类型分流执行

tools
  - 只执行内置与 HTTP 工具
  - 不依赖 workflows/workflow_runtime
```

严禁让 `ToolsService` 调用 `WorkflowRuntimeService`。Workflow 的 Tool 节点本身依赖 Tools，如果反向依赖会形成 `workflow_runtime -> tools -> workflow_runtime` 循环。

## 4. 独立运行协议

### 读取已发布 Workflow 应用

```http
GET /api/v1/workflow-apps
GET /api/v1/workflow-apps/:workflowId
```

返回名称、描述、当前发布版本和由 Start 节点派生的输入定义。

### 运行

```http
POST /api/v1/workflow-apps/:workflowId/runs
Content-Type: application/json

{
  "workflowVersionId": "uuid",
  "inputs": { "query": "用户输入" }
}
```

第一版返回阻塞式结果和完整事件数组；运行内核仍使用异步事件流，后续增加 SSE 时不修改执行器。

## 5. Workflow Tool 协议

Tool Definition 从发布版本生成：

- `name`：稳定的 `workflow_<workflowId>`，避免中文名和重命名影响模型调用协议。
- `description`：Workflow 描述和版本信息。
- `inputSchema`：Start 输入转换成 JSON Schema。
- `output`：End 节点的结构化输出。

Agent Runtime 收到 `workflow:` 前缀后：

1. 校验 ID 中的 Workflow 仍处于发布状态，并读取 ID 固定的不可变 Version。
2. 将工具参数作为 Workflow inputs。
3. 执行 Workflow Runtime。
4. 将 `workflow_completed.data.output` 转换为 `ToolExecutionResult.output`。
5. 将失败事件转换为稳定的工具错误，交回 Agent 推理循环。

## 6. 权限与版本约束

- Workflow 编辑、校验、发布限空间 Owner/Manager。
- 当前空间内有权使用资源的成员可以读取和独立运行已发布 Workflow 应用。
- Agent 新建绑定时只能选择当前发布版本；绑定后继续运行该历史不可变版本，直到管理员主动升级绑定。
- Workflow 归档后不可新运行，已有绑定在调用时明确失败。
- 第一版不开放匿名运行和 Workflow API Key，后续通过 external_access 模块扩展。

## 7. 前端交互

### Workflow 工作室

- 已发布卡片提供“运行”入口。
- 运行弹窗根据 Start inputs 动态生成文本、数字、布尔和 JSON 输入。
- 展示最终输出、失败信息和节点执行摘要。

### Workflow 应用

- 当前空间成员都能从主导航进入独立应用列表。
- 列表只展示当前已发布版本，不暴露草稿 Graph 和编译计划。
- 提交时携带页面读取到的版本 ID；若管理员已发布新版本，服务端拒绝旧表单并提示刷新。

### Agent 编辑

- 工具页签按“普通工具 / Workflow”分组展示。
- Workflow 项显示名称、版本和用途。
- 已绑定历史版本即使不在当前发布列表中也继续可见，避免编辑 Agent 时被无声移除。
- 绑定值仍进入 `toolIds`，不新增另一套提交事务。

## 8. 后续演进

第一版先复用字符串 Tool ID。以下情况出现时再拆专用关系表：

- 需要记录绑定升级历史；
- 需要一个 Agent 对同一 Workflow 绑定多个版本；
- 需要每个绑定独立配置超时、重试或别名；
- 需要数据库外键约束和发布版本下线策略。
