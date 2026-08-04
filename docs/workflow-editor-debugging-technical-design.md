# Mia Workflow 编辑与调试闭环技术方案

## 1. 文档目标

本文定义 Mia Workflow 下一阶段的编辑器与调试技术方案，核心建设链路为：

```text
快速加节点
-> 可视化选变量
-> 一键预览
-> 单节点调试
-> 查看上次运行
-> 校验并发布不可变版本
```

本方案建立在现有 Workflow Graph、Compiler、不可变 `WorkflowVersion`、`AgentRuntimeService` 和 Run Trace 之上，不重新建设执行引擎，也不以复制完整 Dify 为目标。

## 2. 建设目标

完成后，管理员应能：

1. 点击节点出口或连线上的 `+` 快速添加节点。
2. 在支持表达式的字段中浏览、搜索并插入上游变量。
3. 输入 Start 参数并直接运行当前草稿。
4. 使用缓存的上游输出单独调试一个节点。
5. 在节点属性面板查看本次或上次运行的输入、输出、耗时和错误。
6. 自动保存草稿，并支持 Undo/Redo。
7. 发布一个已保存、已校验且内容确定的不可变版本。

## 3. 非目标

- 不建设 Workflow 插件市场。
- 不支持任意 JavaScript、Python 或 Shell 执行。
- 不做多人实时协作编辑。
- 本阶段不新增复杂 Loop、Iteration 或 Subworkflow。
- 草稿测试不写入正式 ChatSession 或 ExternalConversation。
- 不改变已发布 Workflow Version 的不可变语义。
- 不隐式升级 Agent 当前绑定的 Workflow Version。

## 4. 总体架构

```text
Workflow Editor
  -> Graph Command / Undo / Redo
  -> Draft Autosave
  -> Variable Catalog
  -> Preview / Node Debug
       |
       v
WorkflowsController
  -> WorkflowsService
       -> WorkflowCompiler
       -> draft persistence
       -> immutable WorkflowVersion
  -> WorkflowRuntimeService
       -> ModelProvidersService
       -> RetrievalService
       -> ToolsService
       -> AgentRunsService
```

模块职责：

- `workflows`：草稿、Graph、节点定义、变量元数据、编译、校验和发布。
- `agent_runtime`：执行草稿或已发布 Workflow。
- `agent_runs`：记录 Run 和节点步骤。
- `model_providers`：执行模型调用，不感知 Workflow 编辑器。
- `retrieval`：执行知识检索。
- `tools`：执行工具。
- 前端 `features/workflows`：编辑历史、自动保存、变量选择、预览和 Trace UI。

## 5. 强类型节点定义

### 5.1 当前问题

当前节点配置使用：

```ts
type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
};
```

这适合快速建立 V1，但无法可靠支持：

- 节点输入输出类型推导。
- 变量按类型筛选。
- 字段化属性面板。
- 结构化输出 Schema。
- 配置字段级校验。

### 5.2 判别联合

```ts
type WorkflowNode =
  | StartWorkflowNode
  | LlmWorkflowNode
  | RetrievalWorkflowNode
  | ToolWorkflowNode
  | ConditionWorkflowNode
  | TemplateWorkflowNode
  | EndWorkflowNode;

type BaseWorkflowNode<TType, TConfig> = {
  id: string;
  type: TType;
  name: string;
  description?: string;
  config: TConfig;
  position?: WorkflowPosition;
};
```

LLM 节点示例：

```ts
type LlmNodeConfig = {
  modelConfigId: string;
  messages: LlmPromptMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat: "text" | "json_schema";
  outputSchema?: WorkflowVariableSchema;
};

type LlmWorkflowNode = BaseWorkflowNode<"llm", LlmNodeConfig>;
```

### 5.3 前端节点注册表

新增：

```text
frontend/src/features/workflows/nodes/
  registry.ts
  start/
  llm/
  retrieval/
  tool/
  condition/
  template/
  end/
```

统一定义：

```ts
type WorkflowNodeDefinition<TNode extends WorkflowNode> = {
  type: TNode["type"];
  label: string;
  description: string;
  icon: ReactNode;
  createNode: (context: CreateNodeContext) => TNode;
  getOutputSchema: (node: TNode, resources: WorkflowResources) => WorkflowVariableSchema;
  validateClientSide: (node: TNode) => WorkflowValidationIssue[];
  Inspector: ComponentType<NodeInspectorProps<TNode>>;
  helpKey: string;
};
```

注册表负责生成节点面板、快捷添加菜单、属性面板和输出变量 Schema。后端 Compiler 仍然是最终校验权威。

### 5.4 Graph Schema 升级

Graph Schema 提升为 `2`：

```ts
type WorkflowGraphV2 = {
  schemaVersion: 2;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
```

增加统一升级入口：

```ts
function upgradeWorkflowGraph(graph: unknown): WorkflowGraphV2;
```

V1 到 V2 的主要规则：

- LLM `prompt` 转换为 `messages: [{ role: "user", content: prompt }]`。
- `json_object` 转换为 `json_schema`，初始 Schema 为通用 object。
- 其他节点保持等价配置。
- 读取旧草稿时在内存升级，下次保存写回 V2。
- 已发布 V1 Version 保持原样，由对应版本 Compiler 继续执行。

## 6. 快速添加节点

### 6.1 节点出口快捷添加

用户点击节点右侧出口 `+` 后：

1. 获取 `sourceNodeId` 和 `sourceHandle`。
2. 展示节点类型菜单。
3. 创建所选节点。
4. 自动建立边。
5. 自动选中新节点并打开属性面板。
6. 将整个过程记录为一条 Undo Command。

```ts
function appendNode(
  graph: WorkflowGraph,
  command: {
    sourceNodeId: string;
    sourceHandle?: string;
    nodeType: WorkflowNodeType;
  }
): WorkflowGraph;
```

默认位置：

```text
x = source.x + 280
y = source.y
```

位置被占用时每次向下偏移 140px，最多尝试 8 次。

如果该出口已有连线，不直接创建第二条边。UI 提示该出口已连接，并引导用户在现有连线上插入节点。

### 6.2 连线中间插入节点

```ts
function insertNodeOnEdge(
  graph: WorkflowGraph,
  edgeId: string,
  nodeType: WorkflowNodeType
): WorkflowGraph;
```

事务语义：

```text
原边：
source --sourceHandle--> target

插入后：
source --sourceHandle--> newNode
newNode ----------------> target
```

必须保留原始 `sourceHandle`，否则 Condition 分支语义会变化。新节点位置取两端节点坐标的中点。

### 6.3 Graph Command 与历史

新增：

```text
frontend/src/features/workflows/editor/
  graph-commands.ts
  graph-history.ts
  useWorkflowEditor.ts
```

```ts
type GraphCommand =
  | { type: "ADD_NODE"; payload: AddNodePayload }
  | { type: "INSERT_NODE_ON_EDGE"; payload: InsertNodePayload }
  | { type: "DELETE_NODE"; payload: DeleteNodePayload }
  | { type: "CONNECT"; payload: ConnectPayload }
  | { type: "DELETE_EDGE"; payload: DeleteEdgePayload }
  | { type: "MOVE_NODES"; payload: MoveNodesPayload }
  | { type: "UPDATE_NODE_CONFIG"; payload: UpdateConfigPayload };

type GraphHistory = {
  past: WorkflowGraph[];
  present: WorkflowGraph;
  future: WorkflowGraph[];
};
```

约束：

- 节点拖动仅在 `onNodeDragStop` 时记录历史。
- 同一节点同一字段 800ms 内的连续文本修改合并为一条历史。
- 新操作发生后清空 `future`。
- 最多保存 100 条历史。
- 支持 `Cmd/Ctrl+Z` 与 `Cmd/Ctrl+Shift+Z`。

## 7. 自动保存

### 7.1 保存状态机

```ts
type DraftSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "failed";
```

保存策略：

- Graph 修改后标记为 `dirty`。
- 停止修改 1200ms 后自动保存。
- 页面失焦时立即尝试保存。
- 预览、单节点运行和发布前强制 `flushSave()`。
- 保存请求必须串行，禁止较旧响应覆盖较新状态。
- 手动保存按钮保留，用于立即保存和失败重试。

```ts
type DraftSaveQueue = {
  inFlight: Promise<void> | null;
  pendingGraph: WorkflowGraph | null;
  lastSavedRevision: number;
};
```

### 7.2 乐观锁冲突

继续使用 `expectedRevision`：

```http
PUT /api/v1/workflows/:id/draft
```

```json
{
  "expectedRevision": 12,
  "graph": {}
}
```

冲突响应：

```json
{
  "code": "WORKFLOW_DRAFT_CONFLICT",
  "message": "Workflow 草稿已被其他请求更新",
  "currentRevision": 13,
  "updatedAt": "2026-08-03T10:42:31.000Z"
}
```

冲突时不能自动覆盖服务端。UI 提供：

- 重新加载服务端草稿。
- 复制本地 Graph JSON。
- 暂时保留本地修改。

V1 不做 Graph 三方合并。

### 7.3 顶部状态

```text
保存中…
已保存 10:42:31
保存失败，点击重试
草稿发生冲突
```

发布前必须满足：

```text
saveStatus = saved
validation.valid = true
validation.revision = currentRevision
```

## 8. 变量系统

### 8.1 变量描述模型

```ts
type WorkflowValueType =
  "string" | "number" | "boolean" | "object" | "array" | "file" | "files" | "unknown";

type WorkflowVariableSchema = {
  type: WorkflowValueType;
  description?: string;
  nullable?: boolean;
  items?: WorkflowVariableSchema;
  properties?: Record<string, WorkflowVariableSchema>;
};

type WorkflowVariableDescriptor = {
  id: string;
  label: string;
  expression: string;
  source: "input" | "node" | "runtime";
  sourceNodeId?: string;
  path: string[];
  schema: WorkflowVariableSchema;
  available: boolean;
  unavailableReason?: string;
};
```

示例：

```ts
{
  id: "nodes.search.output.chunks",
  label: "知识检索 / chunks",
  expression: "{{nodes.search.output.chunks}}",
  source: "node",
  sourceNodeId: "search",
  path: ["output", "chunks"],
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: {
        content: { type: "string" },
        score: { type: "number" }
      }
    }
  },
  available: true
}
```

### 8.2 节点输出 Schema

Start：由输入定义生成 `input.*`。

LLM 文本模式：

```text
nodes.<id>.output.text: string
```

LLM 结构化模式：

```text
nodes.<id>.output.structured: object
```

Retrieval：

```text
nodes.<id>.output.query: string
nodes.<id>.output.chunks: array<object>
nodes.<id>.output.sources: array<object>
nodes.<id>.output.elapsedMs: number
```

Tool：从工具定义读取输出 Schema；无法确定时使用 `unknown`。

Condition：

```text
nodes.<id>.output.matchedHandle: string
```

Template：

```text
nodes.<id>.output.text: string
```

End：由管理员配置的输出字段生成。

### 8.3 可用变量计算

规则：

- Start 输入对全部节点可用。
- 节点只能引用拓扑上的合法上游节点。
- 禁止引用自身和下游节点。
- Condition 不同分支内的节点不能无条件互相引用。
- 分支汇合后，如果变量不是所有路径都存在，应标记为 nullable 或不可用。
- Runtime 变量按白名单提供。

第一阶段采用保守策略：只有支配当前节点的上游节点输出标记为可用。其他拓扑上游变量可以展示，但必须置灰并说明原因。后端 Compiler 继续完成最终引用校验。

### 8.4 前端组件

```text
frontend/src/features/workflows/components/variables/
  VariablePicker.tsx
  VariableTree.tsx
  VariableTokenInput.tsx
  VariableValueInput.tsx
  VariableInspectorDrawer.tsx
```

支持三种编辑场景：

1. Prompt、System Prompt、Template 等文本字段中插入变量。
2. Retrieval Query 等单值字段选择变量或填写模板。
3. Tool 参数按参数名分别选择常量、变量或模板。

触发方式：

- 点击 `{x}`。
- 输入 `{`。
- 输入 `/`。

### 8.5 Graph 存储兼容

Graph 中继续保存普通模板表达式：

```text
{{input.query}}
{{nodes.search.output.chunks}}
```

变量 Chip 只是编辑展示，不把富文本结构保存到 Graph。现有表达式 Parser 和 Compiler 可以继续使用。

## 9. 字段化节点配置

### 9.1 Start

输入定义改成表格表单：

| 字段        | 说明                                          |
| ----------- | --------------------------------------------- |
| Label       | 面向用户显示的名称                            |
| Name        | 稳定变量名                                    |
| Type        | string/number/boolean/object/array/file/files |
| Required    | 是否必填                                      |
| Default     | 默认值                                        |
| Description | 变量说明                                      |

变量名必须满足 `^[a-zA-Z_][a-zA-Z0-9_]*$`，且同一 Start 节点内不能重名。

### 9.2 LLM

属性面板分为：

```text
设置 | 上次运行
```

设置包括：

- 模型。
- 上下文变量。
- System/User/Assistant 消息列表。
- Temperature。
- Max Tokens。
- Text 或 JSON Schema 输出。
- 超时。
- 重试策略。

所有 Prompt 输入框接入变量选择器。

### 9.3 Tool

根据 Tool Schema 动态生成参数表单，支持：

- 常量。
- 变量。
- 模板。
- 必填提示。
- 参数说明。
- 默认值。
- 枚举选项。

继续保留 `fail` 和 `continue` 两种失败策略。

### 9.4 Condition

以条件组替代原始 JSON：

```ts
type ConditionGroup = {
  logicalOperator: "and" | "or";
  conditions: ConditionExpression[];
};

type ConditionExpression = {
  left: WorkflowValueExpression;
  operator: ConditionOperator;
  right?: WorkflowValueExpression;
};
```

每个条件由变量、操作符和比较值组成，并根据变量类型过滤合法操作符。

### 9.5 End

输出改成字段表格：

```text
名称     类型     值
answer   string   nodes.llm.output.text
sources  array    nodes.search.output.sources
```

Chat Answer 作为主要文本输出单独标记。

## 10. 草稿预览运行

### 10.1 API

创建运行：

```http
POST /api/v1/workflows/:id/draft-runs
```

```ts
type CreateWorkflowDraftRunDto = {
  expectedRevision: number;
  inputs: Record<string, unknown>;
};
```

```ts
type WorkflowDraftRunResponse = {
  runId: string;
  requestId: string;
  workflowId: string;
  revision: number;
  checksum: string;
  status: "QUEUED" | "RUNNING";
};
```

订阅运行事件：

```http
GET /api/v1/workflows/:workflowId/draft-runs/:runId/events
```

SSE 事件固定为：

```text
run_start
node_start
node_token
node_complete
node_error
run_complete
run_canceled
ping
```

### 10.2 执行流程

```text
前端 flush autosave
-> 发送 expectedRevision 和 inputs
-> WorkflowsService 加载服务端 draftGraph
-> Compiler 编译临时 Plan
-> 计算 checksum
-> 创建 DRAFT_TEST Run
-> WorkflowRuntimeService 执行
-> 持续写 RunStep
-> SSE 推送节点事件
```

禁止直接执行客户端请求内附带的临时 Graph。预览必须执行服务端已经保存的 revision，确保审计、Trace 和实际执行内容一致。

### 10.3 Run 数据模型演进

当前 `AgentRun` 强制要求 `agentId`，但独立 Workflow 草稿可能尚未绑定 Agent。建议最小演进：

```prisma
model AgentRun {
  agentId               String?
  workflowId            String?
  workflowVersionId     String?
  workflowDraftRevision Int?
  workflowChecksum      String?
  workflowRunMode       WorkflowRunMode?
}
```

Service 约束：

```text
PUBLISHED:
  agentId 必填
  workflowVersionId 必填

DRAFT_TEST:
  userId 必填
  workflowId 必填
  workflowDraftRevision 必填
  agentId 可空
```

第一阶段保留 `agent_runs` 表和模块名，避免大规模迁移；DTO 和注释需要明确它已经承载通用 Runtime Run。

### 10.4 隔离与限制

草稿运行必须：

- 使用 `WorkflowRunMode.DRAFT_TEST`。
- 不写 ChatSession 和 ExternalConversation。
- 继续复用模型全局及 Provider 并发限制。
- 支持 AbortSignal 和客户端断开取消。
- 记录 request ID 和当前用户 ID。
- 默认仅 Admin 可运行。
- 限制输入体积、总执行时长和输出大小。
- 单用户测试并发初始限制为 2。
- 全局 Workflow 测试并发初始限制为 5。

## 11. 单节点调试

### 11.1 API

```http
POST /api/v1/workflows/:id/draft-nodes/:nodeId/runs
```

```ts
type CreateWorkflowNodeDebugRunDto = {
  expectedRevision: number;
  inputs: Record<string, unknown>;
  cachedNodeOutputs: Record<string, unknown>;
  overrides?: Record<string, unknown>;
};
```

- `inputs`：Start 输入。
- `cachedNodeOutputs`：上游节点缓存输出。
- `overrides`：管理员本次临时修改的变量值。

### 11.2 执行语义

单节点调试只执行当前节点，不自动运行上游：

```text
编译当前草稿
-> 找到目标节点
-> 解析目标节点引用
-> 构建 input/nodes/runtime 变量上下文
-> 检查所有引用是否可解析
-> 执行当前节点
-> 保存 Node Debug Step
```

缺少变量时返回：

```json
{
  "code": "WORKFLOW_DEBUG_VARIABLE_MISSING",
  "message": "节点调试缺少上游变量",
  "missingVariables": ["nodes.search.output.chunks"]
}
```

缺少变量时禁止发起模型、检索或工具调用。

### 11.3 调试缓存

```ts
type WorkflowDebugCache = {
  workflowId: string;
  revision: number;
  checksum: string;
  sourceRunId: string;
  nodeOutputs: Record<string, unknown>;
};
```

Graph revision 或 checksum 变化后缓存立即过期。第一阶段禁止旧缓存继续执行，避免错误结果难以解释。

## 12. 节点上次运行

### 12.1 API

```http
GET /api/v1/workflows/:workflowId/nodes/:nodeId/last-run
    ?mode=DRAFT_TEST
    &revision=15
```

```ts
type WorkflowNodeLastRun = {
  runId: string;
  stepId: string;
  nodeId: string;
  status: string;
  attempt: number;
  input: unknown;
  output: unknown;
  elapsedMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  workflowRevision: number | null;
  workflowVersionId: string | null;
};
```

### 12.2 UI

展示：

- 状态、开始时间和耗时。
- 输入和输出。
- 错误类型和消息。
- 重试次数。
- 模型和 Token 用量。
- 检索来源。
- 工具执行详情。

操作：

- 复制输入或输出。
- 使用本次输入重新运行。
- 将输出保存为调试缓存。
- 跳转到完整 Trace。

API Key、Authorization、Cookie、Tool Secret 和 Provider Secret 必须在后端写 RunStep 前统一脱敏。

## 13. 校验与发布闭环

发布流程：

```text
flush autosave
-> 确认保存 revision
-> 对服务端 revision 执行 validate
-> 返回 checksum
-> 用户确认发布
-> 服务端再次验证 revision 和 checksum
-> 创建不可变 WorkflowVersion
```

发布请求：

```ts
type PublishWorkflowDto = {
  expectedRevision: number;
  expectedChecksum: string;
};
```

服务端必须同时校验 revision 和 checksum，防止出现：

```text
校验 Graph A
-> 草稿被改成 Graph B
-> 实际发布 Graph B
```

发布后草稿仍可继续编辑，但已绑定 Agent 必须显式升级到新 Workflow Version，不能隐式切换线上版本。

## 14. 分阶段实施计划

### Milestone 1：编辑器基础

- 节点注册表。
- 强类型节点配置。
- NodeInspector 拆分。
- Graph Command。
- Undo/Redo。
- 出口快速添加。
- 连线插入节点。
- 自动保存。

验收：

- 三次点击内完成在两个节点之间插入 LLM。
- Undo 一次恢复原连线。
- 刷新页面后自动保存内容不丢失。
- revision 冲突不会静默覆盖。

### Milestone 2：变量系统

- 节点输出 Schema。
- 上游变量目录。
- Variable Picker。
- Prompt 变量插入。
- Start、Tool、Condition 和 End 字段化。
- 后端类型和拓扑校验增强。

验收：

- 常规 Workflow 不需要手写 `{{...}}`。
- 下游节点无法选择未来节点变量。
- 删除或重命名节点后能定位失效引用。
- 发布校验可以定位到节点和字段。

### Milestone 3：完整预览

- Draft Run API。
- DRAFT_TEST Runtime。
- SSE 运行事件。
- Preview Drawer。
- Start 参数表单。
- 停止运行。
- 草稿 Run Trace。

验收：

- 未发布 Workflow 可以运行。
- 页面断开后上游调用被取消。
- 草稿运行不产生 ChatSession。
- 每个节点显示 running/completed/failed。
- Run 对应明确 revision 和 checksum。

### Milestone 4：单节点调试

- Node Debug API。
- 调试变量缓存。
- 缺失变量提示。
- 缓存编辑器。
- 上次运行页签。
- 重新运行。

验收：

- LLM、Retrieval、Tool、Condition 和 Template 可单独运行。
- 缺少变量时不会发起外部调用。
- 旧 revision 缓存不能静默复用。
- 节点输入、输出、耗时和错误可追溯。

### Milestone 5：发布闭环

- 校验 checksum 绑定。
- 发布确认。
- Version 差异摘要。
- Agent 版本升级入口。
- 节点 Trace 跳转。

验收：

- 无法发布未保存草稿。
- 无法发布校验后又发生变化的草稿。
- 发布版本不可修改。
- Agent 不会自动切换版本。

## 15. 测试方案

### 15.1 后端单元测试

Compiler：

- 合法变量引用。
- 未声明输入变量。
- 引用未来节点或自身。
- 跨 Condition 分支非法引用。
- Structured Output 路径校验。
- V1 Graph 升级 V2。
- 相同 Graph 的 checksum 稳定。

Graph：

- 连线插入保留 `sourceHandle`。
- 插入后无环。
- 删除节点同步删除边。
- Condition 每个 Handle 最多一条边。

Draft Run：

- revision 冲突。
- 编译失败不创建外部调用。
- 用户取消和 Provider 超时。
- Tool 失败策略。
- 草稿运行不写 ChatSession。
- Run Step 顺序和 nodeId 正确。

Node Debug：

- 缓存变量齐全。
- 缺少变量。
- 缓存 checksum 过期。
- 非上游变量注入被拒绝。
- 敏感输出脱敏。

### 15.2 前端测试

- 快速追加和连线插入节点。
- Undo/Redo。
- 连续文本输入合并为一条历史。
- 自动保存防抖与响应乱序保护。
- 变量搜索和类型过滤。
- 删除节点后引用失效提示。
- Preview SSE 状态更新。
- SSE 断流和用户停止。
- Node Last Run 展示。

### 15.3 端到端场景

```text
Start -> Retrieval -> LLM -> End
```

```text
Start -> Condition
             |-> Tool -> End
             |-> LLM  -> End
```

覆盖预览成功、LLM 失败、Tool 失败后继续、用户停止、单节点重试、校验发布以及发布后 Agent 固定使用旧版本。

## 16. 关键风险

### 16.1 前后端节点 Schema 漂移

- 后端 Compiler 是最终权威。
- Graph 必须携带 `schemaVersion`。
- 每种节点 Config 都要有 Compiler 测试。

### 16.2 自动保存覆盖较新数据

- 保存请求严格串行。
- 使用 `expectedRevision`。
- 冲突不自动覆盖。
- 页面只接受当前 mutation 对应的响应。

### 16.3 调试缓存使用旧数据

- 缓存绑定 revision 和 checksum。
- Graph 修改后立即标记过期。
- 服务端再次验证缓存来源。

### 16.4 Trace 泄露敏感信息

- 写 RunStep 前统一脱敏。
- 限制字段长度和总输出体积。
- 大输出只保存摘要。
- 文件内容和凭据不写入 Trace。

### 16.5 单节点调试绕过流程约束

- 仍然调用 Compiler。
- 只允许注入目标节点的合法上游变量。
- 资源 ID 仍由所属模块校验。
- 不允许客户端指定任意 Base URL 或凭据。

## 17. 最终实施顺序

```text
强类型节点定义
-> Graph Command
-> 快速添加和 Undo/Redo
-> 自动保存
-> 输出 Schema
-> 变量选择器
-> 字段化 Inspector
-> 草稿预览
-> 单节点调试
-> 上次运行
-> 校验发布闭环
```

必须守住三个关键约束：

1. Graph 中继续保存普通模板表达式，不保存编辑器富文本。
2. 草稿运行只执行服务端已保存 revision，不执行客户端临时 Graph。
3. 单节点调试缓存必须绑定 Workflow revision 和 checksum。

按此方案实施，可以在保持 Mia 轻量、可控和本地部署定位的前提下，显著缩小与 Dify 在 Workflow 编排效率和调试体验上的差距。
