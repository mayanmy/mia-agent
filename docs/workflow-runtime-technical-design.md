# Mia Workflow 数据模型、编译器与 Runtime 技术方案

## 1. 文档目标

本文定义 Mia 可视化编排第一阶段的后端技术方案，覆盖 Workflow 数据模型、图编译校验器、Workflow Runtime、节点执行器、Run Trace、API、测试和分阶段实施计划。

本阶段的目标不是实现完整的 Dify 式 Workflow，而是建立一套可发布、可验证、可追踪的确定性执行内核。后续画布只负责编辑 Workflow Graph，不直接决定运行时行为。

## 2. 建设目标

1. 支持管理员创建和维护 Workflow 草稿。
2. 支持校验、发布和保留不可变 Workflow Version。
3. 将前端 Graph 编译成后端可信的执行计划。
4. 支持 Start、LLM、Retrieval、Tool、Condition、Template、End 节点。
5. 支持 Agent 在 `AGENT_LOOP` 和 `WORKFLOW` 两种模式之间选择。
6. 复用现有模型、知识库、Builtin Tool、HTTP Tool 和动态鉴权能力。
7. 复用现有 Agent Run、Run Step、取消、错误和日志体系。
8. 为后续并行节点、Subworkflow、MCP、人工审批和异步任务预留扩展点。

## 3. V1 范围

### 3.1 V1 实现

- 单一 Start 节点。
- 一个或多个 End 节点。
- 有向无环图。
- 顺序节点和 Condition 分支。
- LLM、Retrieval、Tool、Template 节点。
- 草稿、校验、发布、版本查询。
- Agent 绑定已发布 Workflow Version。
- 非流式测试运行和 Chat SSE 运行。
- 节点级 Run Trace、超时、取消和脱敏。
- 乐观锁防止多人覆盖草稿。

### 3.2 V1 不实现

- 任意循环和循环节点。
- 并行分支与 Join。
- 子流程和递归调用。
- Agent/Subagent 节点。
- 人工审批和暂停恢复。
- 定时器、Webhook 等主动触发器。
- 任意 JavaScript、Python 或脚本节点。
- 节点级缓存。
- Workflow 市场和跨环境导入导出。

## 4. 核心原则

### 4.1 草稿不能直接运行生产流量

正式运行只能引用不可变 `WorkflowVersion`。草稿测试可以临时编译，但必须明确标记 `DRAFT_TEST`，不能被 Agent 发布配置引用。

### 4.2 后端不直接执行画布 JSON

前端提交的节点位置、临时状态和配置都不可信。发布前必须经过 Schema 校验、图校验、资源校验、变量编译和计划生成。

### 4.3 Workflow 是确定性编排

Tool 节点明确指定工具，Retrieval 节点明确指定知识库，Condition 节点明确指定分支。LLM 节点在 V1 不接收工具定义，不允许在节点内部自主发起 Tool Loop。

### 4.4 复用现有模块能力

- LLM 节点调用 `ModelProvidersService`。
- Retrieval 节点调用 `RetrievalService`。
- Tool 节点调用 `ToolsService`。
- HTTP Tool 继续复用动态 Token、SSRF 防护和脱敏。
- Trace 继续写入 `AgentRunsService`。

### 4.5 表达式必须受控

变量引用和条件不能使用 `eval`、`Function` 或任意脚本。所有表达式必须解析成受控 AST，并按白名单操作符执行。

## 5. 总体架构

```text
Workflow Editor
  -> WorkflowsController
  -> WorkflowsService
       -> draft persistence
       -> WorkflowCompiler
            -> graph validator
            -> resource validator
            -> expression parser
            -> compiled plan
       -> immutable WorkflowVersion

Chat / Test Run
  -> AgentRuntimeService
       -> AGENT_LOOP: existing agent loop
       -> WORKFLOW: WorkflowRuntimeService
            -> WorkflowNodeExecutorRegistry
                 -> LLM Executor
                 -> Retrieval Executor
                 -> Tool Executor
                 -> Condition Executor
                 -> Template Executor
            -> AgentRunsService
```

依赖方向：

```text
agent_runtime -> workflow_runtime
workflow_runtime -> workflows
workflow_runtime -> model_providers
workflow_runtime -> retrieval
workflow_runtime -> tools
workflow_runtime -> agent_runs
workflows -> agents 仅通过公开绑定用例协作
```

禁止关系：

```text
workflows -> chat
workflow_runtime -> chat
tools/retrieval/model_providers -> workflow_runtime
node executor -> Prisma
frontend graph -> runtime direct execution
```

## 6. 后端目录

```text
backend/src/modules/
  workflows/
    workflows.module.ts
    workflows.controller.ts
    workflows.service.ts
    workflow-compiler.ts
    workflow-validator.ts
    expression-parser.ts
    dto/
      workflow.dto.ts
      workflow-graph.dto.ts
      workflow-version.dto.ts
      workflow-validation.dto.ts
  workflow_runtime/
    workflow-runtime.module.ts
    workflow-runtime.service.ts
    workflow-context.ts
    expression-resolver.ts
    node-executor.registry.ts
    dto/
      workflow-run.dto.ts
      compiled-plan.dto.ts
      node-execution.dto.ts
    executors/
      start.executor.ts
      llm.executor.ts
      retrieval.executor.ts
      tool.executor.ts
      condition.executor.ts
      template.executor.ts
      end.executor.ts
```

`workflows` 拥有配置、草稿和版本生命周期。`workflow_runtime` 只读取已发布版本并执行，不允许修改 Workflow。

## 7. 数据模型

### 7.1 枚举

```prisma
enum AgentExecutionMode {
  AGENT_LOOP
  WORKFLOW
}

enum WorkflowStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum WorkflowRunMode {
  DRAFT_TEST
  PUBLISHED
}
```

Workflow 节点类型不使用数据库枚举，保存在版本 Graph 和 Compiled Plan 中，避免新增节点类型时频繁修改数据库枚举。

### 7.2 workflows

```prisma
model Workflow {
  id                String         @id @default(uuid()) @db.Uuid
  name              String
  description       String         @default("") @db.Text
  status            WorkflowStatus @default(DRAFT)
  draftGraph        Json           @map("draft_graph") @db.JsonB
  draftRevision     Int            @default(1) @map("draft_revision")
  publishedVersion  Int?           @map("published_version")
  createdByUserId   String         @map("created_by_user_id") @db.Uuid
  createdAt         DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt         DateTime?      @map("deleted_at") @db.Timestamptz(6)
  versions          WorkflowVersion[]

  @@index([status, updatedAt(sort: Desc)])
  @@index([createdByUserId, createdAt(sort: Desc)])
  @@map("workflows")
}
```

使用 `publishedVersion` 而不是 `publishedVersionId`，避免 Workflow 与 WorkflowVersion 形成额外循环关系。实际版本通过 `(workflow_id, version)` 唯一键定位。

### 7.3 workflow_versions

```prisma
model WorkflowVersion {
  id              String   @id @default(uuid()) @db.Uuid
  workflowId      String   @map("workflow_id") @db.Uuid
  version         Int
  graphSchemaVersion Int   @map("graph_schema_version")
  graph           Json     @db.JsonB
  compiledPlan    Json     @map("compiled_plan") @db.JsonB
  checksum        String
  publishedByUserId String @map("published_by_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  workflow        Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)

  @@unique([workflowId, version])
  @@index([workflowId, createdAt(sort: Desc)])
  @@map("workflow_versions")
}
```

Version 创建后禁止更新和删除。Workflow 软删除后仍保留版本及历史 Run 引用。

### 7.4 agent_workflows

Agent 与 Workflow 的绑定关系归属 `agents` 模块：

```prisma
model AgentWorkflow {
  agentId           String   @id @map("agent_id") @db.Uuid
  workflowId        String   @map("workflow_id") @db.Uuid
  workflowVersionId String   @map("workflow_version_id") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([workflowId, workflowVersionId])
  @@map("agent_workflows")
}
```

`AgentsService` 更新绑定前必须调用 `WorkflowsService.getPublishedRuntimeConfig`，不能直接查询 Workflow 表。

### 7.5 Run Trace 扩展

`agent_runs` 增加：

```text
workflow_id UUID NULL
workflow_version_id UUID NULL
workflow_run_mode TEXT NULL
```

这些字段只作为跨模块追踪标识，不建立 Prisma Relation，保持 `agent_runs` 模块独立。

`agent_run_steps` 增加：

```text
node_id TEXT NULL
attempt INTEGER NOT NULL DEFAULT 1
```

现有 Step Type 映射：

| Workflow 节点 | AgentRunStepType |
| ------------- | ---------------- |
| Start、End    | `WORKFLOW`       |
| LLM           | `MODEL`          |
| Retrieval     | `RETRIEVAL`      |
| Tool          | `TOOL`           |
| Condition     | `CONDITION`      |
| Template      | `TRANSFORM`      |

需要为 `AgentRunStepType` 增加 `WORKFLOW`、`CONDITION`、`TRANSFORM`。

## 8. Workflow Graph 协议

```typescript
export type WorkflowGraph = {
  schemaVersion: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
};
```

节点 ID 使用草稿内稳定字符串，不使用数据库 UUID。重命名节点不能改变 ID，否则变量引用会失效。

### 8.1 Start

```typescript
type StartNodeConfig = {
  inputs: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    required: boolean;
    defaultValue?: unknown;
  }>;
};
```

### 8.2 LLM

```typescript
type LlmNodeConfig = {
  modelConfigId: string;
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  timeoutSeconds?: number;
};
```

V1 不提供 `tools` 和 `toolChoice` 字段。

### 8.3 Retrieval

```typescript
type RetrievalNodeConfig = {
  knowledgeBaseIds: string[];
  query: string;
  topK?: number;
  scoreThreshold?: number;
};
```

### 8.4 Tool

```typescript
type ToolNodeConfig = {
  toolId: string;
  arguments: Record<string, unknown>;
  timeoutSeconds?: number;
  failurePolicy?: "fail" | "continue";
};
```

`arguments` 中允许变量模板。Tool 参数最终仍由 `ToolsService` 按工具 Schema 校验。

### 8.5 Condition

```typescript
type ConditionNodeConfig = {
  branches: Array<{
    handle: string;
    left: WorkflowValue;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "exists";
    right?: WorkflowValue;
  }>;
  defaultHandle: string;
};
```

V1 使用结构化条件，不接收自由文本表达式。

### 8.6 Template

```typescript
type TemplateNodeConfig = {
  template: string;
};
```

### 8.7 End

```typescript
type EndNodeConfig = {
  output: Record<string, unknown>;
  answer?: string;
};
```

Chat 场景必须配置 `answer`，测试运行可以只返回结构化 `output`。

## 9. 变量与表达式

V1 支持：

```text
{{input.query}}
{{input.longitude}}
{{nodes.weather.output.body}}
{{nodes.retrieval.output.sources}}
{{runtime.requestId}}
```

不支持：

```text
函数调用
算术表达式
属性赋值
动态下标
原型属性
任意脚本
secret 读取
```

编译后的表达式：

```typescript
type CompiledValue =
  | { kind: "literal"; value: unknown }
  | { kind: "reference"; path: string[] }
  | { kind: "template"; segments: Array<string | { path: string[] }> };
```

路径解析必须拒绝 `__proto__`、`prototype`、`constructor`。解析失败返回明确的节点和字段位置。

## 10. 编译与校验

### 10.1 编译入口

```typescript
async compileWorkflow(request: {
  graph: WorkflowGraph;
  actorUserId: string;
}): Promise<WorkflowCompilationResult>;
```

```typescript
type WorkflowCompilationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  plan?: CompiledWorkflowPlan;
  checksum?: string;
};
```

### 10.2 校验阶段

第一阶段，Graph Schema：

- `schemaVersion` 必须受支持。
- 节点和边数量不得超过系统限制。
- 节点 ID、边 ID 唯一。
- 节点类型必须已注册。
- 节点配置符合对应 DTO。

第二阶段，图结构：

- 恰好一个 Start。
- 至少一个 End。
- Start 没有入边。
- End 没有出边。
- 普通节点最多一条默认出边。
- Condition 的每个 Handle 最多一条出边。
- 所有边引用存在的节点。
- 所有节点从 Start 可达。
- 图中不存在环路。
- 每条可执行路径最终到达 End。

第三阶段，资源：

- Model Config 存在且可用于 Chat。
- Knowledge Base 存在且启用。
- Tool 存在且启用。
- HTTP Tool 参数 Schema 可用。
- 不返回或持久化 Provider Secret、Tool Secret。

第四阶段，变量：

- 引用路径语法正确。
- `input` 字段已在 Start 声明。
- `nodes.x` 引用的节点存在。
- 被引用节点一定在当前节点之前执行。
- Condition 分支不能引用只在另一分支产生的值。

第五阶段，生成计划：

- 移除 `position` 等 UI 字段。
- 生成拓扑顺序和邻接表。
- 编译变量 AST。
- 规范化默认配置。
- 记录资源 ID 和配置指纹。
- 对规范化结果生成 SHA-256 checksum。

### 10.3 校验问题

```typescript
type WorkflowValidationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  field?: string;
};
```

建议错误码：

```text
workflow_invalid_graph
workflow_duplicate_node_id
workflow_missing_start
workflow_invalid_end
workflow_cycle_detected
workflow_unreachable_node
workflow_invalid_edge
workflow_resource_not_found
workflow_resource_disabled
workflow_invalid_reference
workflow_forward_reference
workflow_branch_reference_conflict
```

### 10.4 发布事务

```text
读取并锁定 Workflow
-> 校验 expectedDraftRevision
-> 编译草稿
-> 有 error 则终止
-> version = publishedVersion + 1
-> 插入 WorkflowVersion
-> 更新 Workflow.publishedVersion 和 status
-> 提交事务
```

发布后只允许新建版本，禁止修改历史版本。

## 11. Compiled Plan

```typescript
type CompiledWorkflowPlan = {
  schemaVersion: 1;
  startNodeId: string;
  topologicalOrder: string[];
  nodes: Record<string, CompiledWorkflowNode>;
  outgoingEdges: Record<string, CompiledWorkflowEdge[]>;
  requiredInputs: WorkflowInputDefinition[];
  resourceFingerprints: Record<string, string>;
};
```

Compiled Plan 只保存非敏感配置。模型 API Key、Authorization、Client Secret 和动态 Token 只能在各所属模块内部解析。

## 12. Workflow Runtime

### 12.1 输入

```typescript
type WorkflowRunRequest = {
  requestId: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  workflowId: string;
  workflowVersionId: string;
  mode: "DRAFT_TEST" | "PUBLISHED";
  inputs: Record<string, unknown>;
  signal?: AbortSignal;
};
```

### 12.2 Context

```typescript
type WorkflowContext = {
  input: Record<string, unknown>;
  nodes: Record<string, { output: unknown }>;
  runtime: {
    requestId: string;
    runId: string;
    agentId: string;
    userId?: string;
  };
};
```

Context 只存在于单次运行内。写入 Trace 前必须截断和脱敏。

### 12.3 Runtime Event

```typescript
type WorkflowRuntimeEvent =
  | { type: "workflow_started"; data: Record<string, unknown> }
  | { type: "node_started"; data: Record<string, unknown> }
  | { type: "node_completed"; data: Record<string, unknown> }
  | { type: "node_failed"; data: Record<string, unknown> }
  | { type: "token"; data: { content: string } }
  | { type: "workflow_completed"; data: Record<string, unknown> }
  | { type: "workflow_failed"; data: Record<string, unknown> }
  | { type: "workflow_canceled"; data: Record<string, unknown> };
```

`AgentRuntimeService` 将 Workflow Event 映射到现有 `AgentRuntimeEvent`，Chat 继续只负责 SSE 映射和会话持久化。

### 12.4 主循环

```text
校验 Run 输入
-> 加载 WorkflowVersion 和 Compiled Plan
-> 校验版本仍可执行
-> 初始化 Context
-> currentNode = Start
-> 检查取消与总超时
-> 启动 Node Step
-> 解析节点输入表达式
-> 调用对应 Executor
-> 截断并脱敏输出
-> 完成 Node Step
-> 写入 Context.nodes
-> 根据普通边或 Condition Handle 选择下一节点
-> 到达 End 后完成 Run
```

Runtime 不按照前端 nodes 数组顺序执行，只按照 Compiled Plan 的边和 Handle 执行。

### 12.5 执行限制

建议初始值：

| 限制                    | 默认值 |
| ----------------------- | ------ |
| 最大节点数              | 50     |
| 最大边数                | 100    |
| 单次实际执行节点数      | 50     |
| Workflow 总超时         | 180 秒 |
| 普通节点默认超时        | 30 秒  |
| LLM 节点默认超时        | 120 秒 |
| 单节点 Trace Preview    | 10 KB  |
| 单节点 Context Output   | 1 MB   |
| Workflow Context 总大小 | 5 MB   |

## 13. Node Executor

```typescript
interface WorkflowNodeExecutor<TConfig = unknown> {
  readonly type: WorkflowNodeType;

  execute(request: {
    node: CompiledWorkflowNode<TConfig>;
    context: WorkflowContext;
    signal?: AbortSignal;
  }): Promise<NodeExecutionResult> | AsyncIterable<NodeExecutionEvent>;
}
```

```typescript
type NodeExecutionResult = {
  status: "completed" | "failed" | "skipped";
  output: Record<string, unknown>;
  nextHandle?: string;
};
```

注册表必须拒绝重复 Node Type，未注册节点在编译期报错，不能等到运行时才失败。

### 13.1 LLM Executor

- 调用 `ModelProvidersService.streamChatCompletion`。
- V1 不传入 Tools。
- 支持文本和 JSON Object 输出。
- JSON 输出必须解析失败即节点失败。
- 继续复用 Provider 超时、重试、并发、取消和熔断。
- Token 可以透传为 Runtime Event。

### 13.2 Retrieval Executor

- 调用 `RetrievalService.retrieveKnowledgeContext`。
- 输出 chunks、sources 和 elapsedMs。
- Context 可保留完整结果，Trace 只保存来源与截断 Preview。
- 知识库为空或被禁用时返回明确错误。

### 13.3 Tool Executor

- 调用 `ToolsService.executeTool`。
- 复用参数校验、HTTP 安全策略、动态鉴权和日志。
- 默认不重试，防止 POST 等副作用工具重复执行。
- `failurePolicy=continue` 时输出结构化错误并继续流程。
- Tool 输入、输出按工具敏感字段规则脱敏。

### 13.4 Condition Executor

- 按顺序计算 branches。
- 首个命中分支返回对应 `nextHandle`。
- 全部未命中时使用 `defaultHandle`。
- 比较操作必须检查类型，不执行隐式危险转换。

### 13.5 Template Executor

- 只做变量插值。
- 对象或数组插入字符串时使用 JSON 序列化。
- 缺失变量默认失败，不静默替换为空字符串。

### 13.6 Start 与 End Executor

- Start 校验输入类型、必填值和默认值。
- End 解析结构化输出和 Chat answer。
- End 输出成为最终 `run_completed` 内容。

## 14. Agent Runtime 集成

`AgentRuntimeConfig` 增加：

```typescript
type AgentRuntimeConfig = {
  executionMode: "AGENT_LOOP" | "WORKFLOW";
  workflow?: {
    workflowId: string;
    workflowVersionId: string;
  };
};
```

`AgentRuntimeService.runAgent` 在创建 Run 后分派：

```text
AGENT_LOOP
  -> 现有 Retrieval + Model + Tool Loop

WORKFLOW
  -> WorkflowRuntimeService.runWorkflow
```

Agent 发布时必须满足：

- `AGENT_LOOP` 可以没有 Workflow。
- `WORKFLOW` 必须绑定已发布版本。
- 绑定版本必须属于指定 Workflow。
- Workflow Version 必须至少有一个可返回 Chat answer 的 End。

## 15. API 设计

### 15.1 Workflow 管理

```text
GET    /api/v1/workflows
POST   /api/v1/workflows
GET    /api/v1/workflows/:id
PUT    /api/v1/workflows/:id
PUT    /api/v1/workflows/:id/draft
DELETE /api/v1/workflows/:id
```

更新草稿请求必须传入：

```json
{
  "expectedRevision": 3,
  "graph": {}
}
```

Revision 不一致返回 `409 workflow_revision_conflict`。

### 15.2 校验和发布

```text
POST /api/v1/workflows/:id/validate
POST /api/v1/workflows/:id/publish
GET  /api/v1/workflows/:id/versions
GET  /api/v1/workflows/:id/versions/:versionId
```

### 15.3 测试运行

```text
POST /api/v1/workflows/:id/test-runs
POST /api/v1/workflows/:id/test-stream
```

测试运行默认使用当前草稿临时编译结果，不创建 WorkflowVersion，但必须创建 Agent Run 并标记 `DRAFT_TEST`。

### 15.4 Agent 绑定

```text
PUT /api/v1/agents/:agentId/workflow
```

```json
{
  "executionMode": "WORKFLOW",
  "workflowId": "uuid",
  "workflowVersionId": "uuid"
}
```

V1 的创建、编辑、发布、删除和绑定接口仅允许 Admin。普通 User 只能运行已发布 Agent。

## 16. 错误模型

新增错误码分组：

```text
workflow_not_found
workflow_version_not_found
workflow_revision_conflict
workflow_validation_failed
workflow_not_published
workflow_resource_unavailable
workflow_node_failed
workflow_node_timeout
workflow_execution_limit_exceeded
workflow_context_too_large
workflow_output_invalid
```

对外错误包含安全消息、nodeId 和 retryable，不返回堆栈、Prompt 全文、Secret 或外部 Authorization。

## 17. 安全与治理

1. 禁止任意脚本和动态代码执行。
2. 禁止 Workflow Context 读取 Secret。
3. HTTP Tool 继续执行 SSRF 和 Allowlist 校验。
4. Authorization、Client Secret 和 Token 只在 Tool Executor 内存中出现。
5. Run Trace 保存前执行统一递归脱敏。
6. 节点输入输出设置大小上限。
7. Graph 设置节点数、边数和字符串长度上限。
8. 发布记录操作者和 checksum。
9. 删除 Workflow 使用软删除。
10. 历史 Version 和 Run 不随草稿更新改变。

## 18. 并发、取消与重试

- Workflow Runtime 不创建线程，继续使用 Node.js 异步调用。
- `AbortSignal` 必须传入每个 Executor 和外部调用。
- 用户断开 SSE 后取消当前节点和整个 Workflow。
- Runtime 总超时与节点超时分别记录。
- LLM 重试由模型网关负责。
- Retrieval 可以由调用模块执行幂等重试。
- Tool 默认不重试。
- Condition、Template 等纯节点可以内部重试一次，但通常没有必要。
- V1 单个 Workflow Run 内顺序执行，不引入并行调度器。

## 19. 可观测性

Run 列表增加：

```text
execution_mode
workflow_id
workflow_version_id
workflow_run_mode
```

Run Detail 增加：

```text
node_id
node_type
attempt
selected_handle
```

建议指标：

```text
workflow_run_total
workflow_run_success_total
workflow_run_failed_total
workflow_run_canceled_total
workflow_node_duration_ms
workflow_node_failed_total
workflow_compile_duration_ms
workflow_validation_failed_total
```

V1 先通过数据库统计，不要求立即引入 Prometheus。

## 20. 测试方案

### 20.1 编译器单元测试

- 正常顺序图编译成功。
- Condition 多分支编译成功。
- 重复节点 ID。
- 缺少 Start 或 End。
- 无效 Edge、悬空节点和不可达节点。
- 环路检测。
- 非法资源引用。
- 前向变量引用。
- 跨分支不安全引用。
- 危险属性路径拒绝。
- 相同 Graph 生成相同 checksum。

### 20.2 Runtime 单元测试

- Start 到 End 正常运行。
- LLM Token 流式输出。
- Retrieval 结果进入后续 Prompt。
- Tool 参数变量解析。
- Condition 选择正确 Handle。
- Template 缺少变量失败。
- Tool continue/fail 两种策略。
- 节点超时、总超时和用户取消。
- Context 和输出大小限制。
- Run 和 Step 状态完整收敛。

### 20.3 Service 集成测试

- 草稿 Revision 冲突。
- 发布事务生成不可变版本。
- 历史版本不受新草稿影响。
- Agent 只能绑定已发布版本。
- Workflow 模式 Chat 返回 End answer。
- HTTP Tool 动态鉴权仍脱敏。

### 20.4 迁移验证

```text
npm run db:validate
npm run db:generate
npm run typecheck
npm --prefix backend test
npm run build
```

## 21. 实施阶段

### 阶段 W1：数据模型与版本管理

- 新增 Workflow、WorkflowVersion 和 AgentWorkflow 表。
- 扩展 Agent executionMode。
- 扩展 Agent Run 和 Step 字段。
- 实现 Workflow CRUD、草稿乐观锁和版本查询。

提交：

```text
feat: 新增 Workflow 数据模型与版本管理
```

### 阶段 W2：编译校验器

- 定义 Graph 和 Node DTO。
- 实现结构、DAG、资源和变量校验。
- 实现表达式 Parser。
- 生成 Compiled Plan 和 checksum。
- 实现 validate 与 publish。

提交：

```text
feat: 实现 Workflow 图校验与编译器
```

### 阶段 W3：基础 Runtime

- 实现 Context、Runtime 主循环和 Executor Registry。
- 实现 Start、Template、Condition、End。
- 实现取消、超时和执行限制。

提交：

```text
feat: 实现 Workflow Runtime 基础执行链路
```

### 阶段 W4：能力节点

- 实现 LLM、Retrieval 和 Tool Executor。
- 接入模型流、知识检索、HTTP Tool 和动态鉴权。
- 实现节点输出协议与失败策略。

提交：

```text
feat: 接入 Workflow 模型检索与工具节点
```

### 阶段 W5：Agent 与 Trace 集成

- Agent Runtime 增加执行模式分派。
- Chat、公开访问和 Service API 复用 Workflow Runtime。
- Run Trace 展示 Workflow Version 和 Node Step。
- 完成测试运行接口。

提交：

```text
feat: 接入 Agent Workflow 执行与节点追踪
```

### 阶段 W6：可视化编辑器

- 实现节点画布、属性面板和连线。
- 实现校验问题定位。
- 实现发布、测试运行和 Trace 回放。

提交：

```text
feat: 增加 Workflow 可视化编排界面
```

## 22. 验收标准

V1 后端完成必须同时满足：

1. Workflow 草稿可以保存且支持 Revision 冲突检测。
2. 非法图无法发布，并返回可定位到节点和字段的问题。
3. 发布版本不可修改，历史运行可以定位到准确版本。
4. Runtime 不直接执行草稿 Graph。
5. Start、LLM、Retrieval、Tool、Condition、Template、End 全部可运行。
6. Tool 节点复用现有 HTTP Tool 安全和动态鉴权能力。
7. 用户取消可以终止当前模型或工具调用。
8. 每个运行都有 Run，每个实际执行节点都有 Step。
9. Trace 不包含 Secret、Authorization、Token 和图片 Data URL。
10. Agent 的 `AGENT_LOOP` 行为保持兼容。
11. 单元测试、集成测试、类型检查和构建全部通过。

## 23. 后续演进

V2 可以增加并行分支、Join、节点重试配置、失败分支和指定节点重跑。

V3 可以增加 Subworkflow、Agent/Subagent、MCP、人工审批、Webhook 和定时触发。新增能力必须继续通过 Compiled Plan 和 Node Executor Registry 扩展，不能绕过编译器直接执行画布配置。
