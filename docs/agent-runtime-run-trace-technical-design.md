# Agent Runtime 与 Run Trace 技术方案

> 实施状态：已完成核心 Runtime 与 Run Trace。本文中的“当前实现与问题”描述的是改造前基线；当前工作台 Chat、公开入口、Service API 和 Workflow 已接入统一运行记录，页面产品名为“运行链路”。

## 1. 文档目标

本文定义 Mia 建立统一 Agent Runtime 和 Run Trace 的详细技术方案，并作为后续开发、评审和验收基线。

建设目标：

1. 将 Agent 执行编排从 `chat.service.ts` 中逐步抽离。
2. 让工作台 Chat、公开 Widget、Service API 和后续异步任务复用同一 Runtime。
3. 为每次 Agent 执行建立完整 Run，并记录 Retrieval、Model、Tool 等 Step。
4. 统一成功、失败、取消和超时状态。
5. 贯通 `request_id`、`run_id`、`session_id` 和工具调用 ID。
6. 在不改变现有 SSE 协议和用户行为的前提下分阶段迁移。

本文原阶段只建设 Agent Runtime 和 Run Trace。此后 MCP Client 已接入 Runtime；Skills 的管理与导入已实现，但 Agent 绑定和 Runtime 注入仍未完成；AgentVersion、Memory、Subagents 和开放 Hooks 仍属后续能力。

## 2. 改造前基线与问题（历史）

### 2.1 当前调用链

当前工作台流式对话路径为：

```text
ChatController.streamCompletion
  -> ChatService.streamCompletion
       -> AgentsService.getAgentRuntimeConfig
       -> ChatSessionsService
       -> RetrievalService
       -> ModelProvidersService.streamChatCompletion
       -> ToolsService.executeTool
       -> ChatStreamEvent
```

公开 Widget 和 Service API 通过 `external_access` 调用 `ChatService`，并使用 `externalHistory` 和 `skipInternalSessionPersistence` 避免写入工作台会话表。

### 2.2 当前已有基础

- `ChatController` 已使用 `AbortController` 监听客户端断开。
- 模型和工具调用已经接收 `AbortSignal`。
- Chat 已支持 Retrieval、模型流、Tool Loop 和多轮工具调用。
- SSE 事件类型已经固定。
- Middleware 已生成 `request_id` 并写入 HTTP 响应头。
- 工具调用已经写入 `tool_call_logs`。
- 内部会话与外部会话已经分表管理。

### 2.3 主要问题

1. `ChatService` 同时负责会话、输入校验、RAG、Prompt、模型、工具和输出协议，职责过多。
2. 非流式与流式路径存在重复编排，后续接入 MCP 和 Skills 会继续放大重复。
3. 当前只有工具调用日志，没有一次 Agent 执行的顶层 Run。
4. Retrieval、Model 和 Tool 无法在同一时间线中关联。
5. `ChatService` 内部创建随机 request ID，没有沿用 HTTP Middleware 的 request ID。
6. 失败和取消缺少统一状态机，无法可靠统计成功率、取消率和阶段耗时。
7. Chat 事件直接承担运行时语义，后续异步任务难以复用。

## 3. 设计原则

### 3.1 先 Trace，后抽 Runtime

第一阶段只在现有执行路径中记录 Run 和 Step，不改变现有业务行为。验证数据模型后再抽离 Runtime，降低一次性重构风险。

### 3.2 Runtime 不依赖 HTTP 和 SSE

Runtime 接收可序列化业务 DTO 和 `AbortSignal`，输出 `AsyncGenerator<AgentRuntimeEvent>`。Runtime 不接收 Nest Request、Response，不写 SSE 字符串。

### 3.3 Chat 保留会话所有权

`chat` 继续负责：

- 内部会话创建和归属校验。
- 历史消息读取。
- 用户消息和完整助手消息持久化。
- SSE 心跳和协议映射。
- 客户端断开检测。

Runtime 不直接读写 `chat_sessions` 和 `chat_session_messages`。

### 3.4 Runtime 只做跨模块编排

Runtime 可以调用 `agents`、`retrieval`、`model_providers`、`tools` 和 `agent_runs` 的公开 Service，不直接查询这些模块的数据表。

### 3.5 Trace 写入弱依赖

Run Trace 用于排障、统计和评测。Trace 单次 Step 写入失败不能中断已经开始的模型回答，但顶层 Run 创建失败需要降级记录错误日志，并允许对话继续。

### 3.6 默认最小化记录

Trace 默认保存 ID、配置快照摘要、耗时、状态和截断 Preview，不保存 API Key、Authorization、附件 Data URL、完整敏感 Prompt 或无限长度工具输出。

## 4. 目标架构

```text
ChatController / ExternalAccessController
                  |
                  v
             ChatService
       session/history/SSE mapping
                  |
                  v
         AgentRuntimeService
      orchestration/runtime events
       /       |        |       \
      v        v        v        v
 Agents   Retrieval   Models    Tools
                  |
                  v
          AgentRunsService
```

目标依赖方向：

```text
chat -> agent_runtime
external_access -> chat
agent_runtime -> agents
agent_runtime -> retrieval
agent_runtime -> model_providers
agent_runtime -> tools
agent_runtime -> agent_runs
agent_runs -> prisma
```

禁止关系：

```text
agents/retrieval/model_providers/tools -> agent_runtime
agent_runs -> chat
agent_runs -> external_access
agent_runtime -> chat_sessions 数据表
```

## 5. 后端目录设计

```text
backend/src/modules/
  agent_runtime/
    agent-runtime.module.ts
    agent-runtime.service.ts
    prompt-builder.ts
    runtime-error.ts
    dto/
      agent-run.dto.ts
      runtime-event.dto.ts
  agent_runs/
    agent-runs.module.ts
    agent-runs.controller.ts
    agent-runs.service.ts
    dto/
      agent-run.dto.ts
      agent-run-step.dto.ts
```

职责：

| 文件                       | 职责                                 |
| -------------------------- | ------------------------------------ |
| `agent-runtime.service.ts` | 编排 Agent、Retrieval、Model 和 Tool |
| `prompt-builder.ts`        | 纯函数组装模型消息和 RAG Context     |
| `runtime-error.ts`         | 统一运行错误分类和外部安全消息       |
| `agent-runs.service.ts`    | Run/Step 状态流转、查询和脱敏        |
| `agent-runs.controller.ts` | 管理员 Run 列表和详情接口            |

## 6. 数据库设计

### 6.1 枚举

```prisma
enum AgentRunSource {
  INTERNAL_CHAT
  PUBLIC_WIDGET
  SERVICE_API
  ASYNC_TASK
}

enum AgentRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELED
  TIMED_OUT
}

enum AgentRunStepType {
  RETRIEVAL
  MODEL
  TOOL
  HOOK
  SUBAGENT
}

enum AgentRunStepStatus {
  RUNNING
  COMPLETED
  FAILED
  CANCELED
  SKIPPED
}
```

`HOOK` 和 `SUBAGENT` 在当前阶段不执行，只为未来 Trace 类型预留，避免后续破坏枚举和查询接口。

### 6.2 agent_runs

```prisma
model AgentRun {
  id                     String         @id @default(uuid()) @db.Uuid
  requestId              String         @map("request_id")
  source                 AgentRunSource
  agentId                String         @map("agent_id") @db.Uuid
  userId                 String?        @map("user_id") @db.Uuid
  sessionId              String?        @map("session_id") @db.Uuid
  externalConversationId String?        @map("external_conversation_id") @db.Uuid
  status                 AgentRunStatus @default(QUEUED)
  modelConfigId          String?        @map("model_config_id") @db.Uuid
  inputPreview           String         @map("input_preview") @db.Text
  outputPreview          String?        @map("output_preview") @db.Text
  inputTokens            Int?           @map("input_tokens")
  outputTokens           Int?           @map("output_tokens")
  estimatedCost          Decimal?       @map("estimated_cost") @db.Decimal(12, 6)
  firstTokenAt           DateTime?      @map("first_token_at") @db.Timestamptz(6)
  startedAt              DateTime?      @map("started_at") @db.Timestamptz(6)
  finishedAt             DateTime?      @map("finished_at") @db.Timestamptz(6)
  errorType              String?        @map("error_type")
  errorMessage           String?        @map("error_message") @db.Text
  createdAt              DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)
  agent                  Agent          @relation(fields: [agentId], references: [id], onDelete: Cascade)
  user                   User?          @relation(fields: [userId], references: [id], onDelete: SetNull)
  steps                  AgentRunStep[]

  @@index([requestId], map: "idx_agent_runs_request_id")
  @@index([agentId, createdAt(sort: Desc)], map: "idx_agent_runs_agent_created_at")
  @@index([userId, createdAt(sort: Desc)], map: "idx_agent_runs_user_created_at")
  @@index([status, createdAt(sort: Desc)], map: "idx_agent_runs_status_created_at")
  @@index([sessionId, createdAt(sort: Desc)], map: "idx_agent_runs_session_created_at")
  @@index([externalConversationId, createdAt(sort: Desc)], map: "idx_agent_runs_external_conversation_created_at")
  @@map("agent_runs")
}
```

设计说明：

- `requestId` 不设置唯一约束，未来一个 HTTP 请求可能创建父 Run 和子 Run。
- `sessionId` 和 `externalConversationId` 只作为可追踪业务 ID，不建立跨模块 Prisma Relation。
- `userId` 仅表示 Mia 内部用户；公开访客通过外部会话定位，不伪造内部用户。
- AgentVersion 落地后新增 `agentVersionId`，当前不提前建立空表。
- 删除 Agent 时 Run 是否级联删除需要谨慎。首期 Prisma 可使用 `Cascade` 与现有模型保持一致；上线审计保留后建议改为软删除 Agent 并限制物理删除。

### 6.3 agent_run_steps

```prisma
model AgentRunStep {
  id           String             @id @default(uuid()) @db.Uuid
  runId        String             @map("run_id") @db.Uuid
  sequence     Int
  type         AgentRunStepType
  name         String
  status       AgentRunStepStatus @default(RUNNING)
  input        Json?              @db.JsonB
  output       Json?              @db.JsonB
  elapsedMs    Int?               @map("elapsed_ms")
  errorType    String?            @map("error_type")
  errorMessage String?            @map("error_message") @db.Text
  startedAt    DateTime           @default(now()) @map("started_at") @db.Timestamptz(6)
  finishedAt   DateTime?          @map("finished_at") @db.Timestamptz(6)
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  run          AgentRun           @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, sequence], map: "uq_agent_run_steps_run_sequence")
  @@index([runId, sequence], map: "idx_agent_run_steps_run_sequence")
  @@index([type, startedAt(sort: Desc)], map: "idx_agent_run_steps_type_started_at")
  @@index([status, startedAt(sort: Desc)], map: "idx_agent_run_steps_status_started_at")
  @@map("agent_run_steps")
}
```

V1 Runtime 仍串行执行 Step，由 Runtime 在内存中递增 `sequence`。未来出现并行子任务时，由 Run Context 统一分配序号，不能依赖数据库 `max(sequence) + 1` 竞争写入。

### 6.4 tool_call_logs 兼容

现有 `tool_call_logs` 暂时保留，并新增：

```prisma
runId  String? @map("run_id") @db.Uuid
stepId String? @map("step_id") @db.Uuid
```

首期不建立 Prisma Relation，避免工具日志归属和 Run Trace 生命周期互相耦合。工具执行继续写原表，同时关联 Run/Step。稳定运行一段时间后再决定是否合并查询能力。

## 7. DTO 设计

### 7.1 AgentRunRequest

```typescript
export type AgentRunSource = "INTERNAL_CHAT" | "PUBLIC_WIDGET" | "SERVICE_API" | "ASYNC_TASK";

export type AgentRunRequest = {
  requestId: string;
  source: AgentRunSource;
  agentId: string;
  userId?: string;
  sessionId?: string;
  externalConversationId?: string;
  message: {
    text: string;
    images?: AgentImageInput[];
    files?: AgentFileInput[];
  };
  history: ChatMessage[];
  signal?: AbortSignal;
};
```

约束：

- `requestId` 必须由入口传入，HTTP 请求沿用 Middleware 产生的值。
- Runtime 不负责查询会话历史，调用方传入已完成权限校验的历史。
- 附件 DTO 可以包含模型调用所需内容，但 Trace 绝不持久化 Data URL 和完整附件文本。

### 7.2 RuntimeEvent

```typescript
export type AgentRuntimeEvent =
  | { type: "run_started"; data: { runId: string } }
  | { type: "retrieval_started"; data: { stepId: string } }
  | {
      type: "retrieval_completed";
      data: { stepId: string; chunkCount: number; elapsedMs: number; sources: RetrievalSource[] };
    }
  | { type: "model_started"; data: { stepId: string; modelConfigId: string } }
  | { type: "token"; data: { content: string } }
  | { type: "tool_started"; data: RuntimeToolCall }
  | { type: "tool_completed"; data: RuntimeToolResult }
  | { type: "run_completed"; data: RuntimeCompletion }
  | { type: "run_failed"; data: RuntimeError }
  | { type: "run_canceled"; data: { runId: string } };
```

### 7.3 RuntimeCompletion

```typescript
export type RuntimeCompletion = {
  runId: string;
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
};
```

非流式接口直接返回 `RuntimeCompletion`；流式接口消费事件并将最终完成事件映射为已有 `message_end`。

## 8. 状态机

### 8.1 Run 状态

```text
QUEUED -> RUNNING -> COMPLETED
                  -> FAILED
                  -> CANCELED
                  -> TIMED_OUT
```

合法状态流转：

| 当前状态  | 允许目标状态                                   |
| --------- | ---------------------------------------------- |
| `QUEUED`  | `RUNNING`、`CANCELED`、`FAILED`                |
| `RUNNING` | `COMPLETED`、`FAILED`、`CANCELED`、`TIMED_OUT` |
| 终态      | 不允许继续更新状态                             |

`AgentRunsService` 使用 `updateMany({ where: { id, status: ... } })` 或事务内条件更新保证状态流转幂等。禁止暴露通用 `updateRun`。

### 8.2 Step 状态

```text
RUNNING -> COMPLETED
        -> FAILED
        -> CANCELED
        -> SKIPPED
```

当 Run 进入终态时，仍为 `RUNNING` 的 Step 必须被收敛：

- Run `CANCELED`：Step 变为 `CANCELED`。
- Run `TIMED_OUT`：Step 变为 `FAILED`，错误类型为 `run_timeout`。
- Run `FAILED`：当前 Step 变为 `FAILED`。

## 9. AgentRunsService 设计

公开方法：

```typescript
createRun(input: CreateAgentRunDto): Promise<AgentRunContext>;
startRun(runId: string, modelConfigId?: string): Promise<void>;
markFirstToken(runId: string): Promise<void>;
completeRun(runId: string, result: CompleteAgentRunDto): Promise<void>;
failRun(runId: string, error: RuntimeError): Promise<void>;
cancelRun(runId: string): Promise<void>;
timeoutRun(runId: string): Promise<void>;

startStep(input: StartAgentRunStepDto): Promise<AgentRunStepContext>;
completeStep(stepId: string, output?: TraceJsonValue): Promise<void>;
failStep(stepId: string, error: RuntimeError): Promise<void>;
cancelStep(stepId: string): Promise<void>;
skipStep(stepId: string, reason: string): Promise<void>;

listRuns(query: AgentRunQueryDto, currentUser: CurrentUserDto): Promise<PageResult<AgentRunListItem>>;
getRunDetail(runId: string, currentUser: CurrentUserDto): Promise<AgentRunDetail>;
```

`AgentRunContext` 至少包含：

```typescript
export type AgentRunContext = {
  runId: string;
  requestId: string;
  nextSequence: () => number;
};
```

### 9.1 Trace 写入降级

Runtime 内使用安全封装：

```typescript
private async safelyTrace(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    // Trace 写入失败不得中断模型输出，同时写入基础错误日志。
    this.logger.error(...);
  }
}
```

Run 创建失败时使用临时 UUID 作为内存 `runId`，继续执行并写基础错误日志。响应中的 Run ID 仍可用于关联进程日志，但管理端可能查不到数据库记录。

## 10. Trace 内容规范

### 10.1 通用限制

```text
inputPreview 最大 2,000 字符
outputPreview 最大 4,000 字符
Step JSON 序列化后最大 32 KB
错误消息最大 2,000 字符
工具输出 Preview 最大 8,000 字符
```

超出限制统一截断，并增加：

```json
{ "truncated": true }
```

禁止持久化字段：

- `authorization`
- `apiKey`、`api_key`
- `token`、`accessToken`、`refreshToken`
- `cookie`、`set-cookie`
- `password`、`secret`
- 图片 Data URL
- 完整文件内容
- Provider 原始请求 Header

字段名脱敏需要忽略大小写并递归处理对象和数组。

### 10.2 Retrieval Step

输入：

```json
{
  "queryPreview": "用户问题",
  "knowledgeBaseIds": ["..."],
  "topK": 6,
  "scoreThreshold": 0.6
}
```

输出：

```json
{
  "chunkCount": 4,
  "sources": [
    {
      "knowledgeBaseId": "...",
      "documentId": "...",
      "chunkId": "...",
      "score": 0.82,
      "preview": "截断后的片段"
    }
  ]
}
```

### 10.3 Model Step

输入记录：

- `modelConfigId`
- `providerType`
- 消息数量和角色分布
- 工具定义数量
- temperature、maxTokens、timeoutSeconds
- Prompt 字符数或 Token 估算

输出记录：

- input/output Tokens
- 首 Token 耗时
- 总耗时
- finish reason
- Tool Call 数量和名称
- 回答 Preview

首期不记录完整 Prompt。V3 调试器需要完整 Prompt 时，另设管理员开关、加密或短期存储，不能默认开启。

### 10.4 Tool Step

输入记录：

- toolId、toolCallId
- source：`builtin`、未来 `mcp`
- 脱敏后的参数

输出记录：

- ok、elapsedMs
- 截断并脱敏的输出
- errorType、errorMessage

## 11. 统一错误模型

```typescript
export type RuntimeErrorType =
  | "agent_not_found"
  | "agent_disabled"
  | "model_unavailable"
  | "model_auth_failed"
  | "model_rate_limited"
  | "model_timeout"
  | "context_too_long"
  | "retrieval_failed"
  | "tool_not_found"
  | "tool_input_invalid"
  | "tool_execution_failed"
  | "tool_round_limit_exceeded"
  | "run_timeout"
  | "canceled"
  | "internal_error";

export type RuntimeError = {
  type: RuntimeErrorType;
  message: string;
  publicMessage: string;
  retryable: boolean;
  cause?: unknown;
};
```

`cause` 只存在于进程内，不写 API 响应；写 Trace 前转换为脱敏后的错误名称和消息。

## 12. Runtime 执行流程

### 12.1 主流程

```text
create Run(QUEUED)
-> emit run_started
-> load AgentRuntimeConfig
-> start Run(RUNNING)
-> resolve ToolDefinitions
-> start Retrieval Step
-> retrieve Knowledge
-> complete Retrieval Step
-> build Messages
-> loop 0..MAX_TOOL_ROUNDS
     -> start Model Step
     -> stream Model
     -> mark first token once
     -> complete/fail Model Step
     -> no Tool Call: complete Run and return
     -> start Tool Step for each call
     -> execute Tool
     -> complete/fail Tool Step
     -> append Tool result and continue
-> tool rounds exceeded: fail Run
```

### 12.2 伪代码

```typescript
async *runAgent(request: AgentRunRequest): AsyncGenerator<AgentRuntimeEvent> {
  const run = await this.createRunSafely(request);
  let activeStepId: string | undefined;

  try {
    yield { type: "run_started", data: { runId: run.runId } };

    const agent = await this.agentsService.getAgentRuntimeConfig(request.agentId);
    await this.agentRunsService.startRun(run.runId, agent.modelConfigId);

    const tools = this.toolsService.getToolDefinitions(agent.toolIds);
    const retrieval = await this.runRetrievalStep(run, request, agent);
    const messages = buildRuntimeMessages(agent, request, retrieval, tools);

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const modelResult = yield* this.runModelStep(run, agent, messages, tools, request.signal);

      if (modelResult.toolCalls.length === 0) {
        await this.agentRunsService.completeRun(run.runId, modelResult);
        yield { type: "run_completed", data: toRuntimeCompletion(modelResult) };
        return;
      }

      if (round >= MAX_TOOL_ROUNDS) {
        throw runtimeError("tool_round_limit_exceeded");
      }

      for (const toolCall of modelResult.toolCalls) {
        yield* this.runToolStep(run, request, messages, toolCall);
      }
    }
  } catch (error) {
    const runtimeError = normalizeRuntimeError(error, request.signal);
    await this.finishFailedRun(run.runId, activeStepId, runtimeError);
    yield toTerminalRuntimeEvent(run.runId, runtimeError);
  } finally {
    await this.ensureRunTerminal(run.runId);
  }
}
```

## 13. 请求 ID、Run ID 和上下文传递

### 13.1 request_id 来源

HTTP 路径必须沿用 `requestIdMiddleware` 写入 Request 的值：

```typescript
type RequestWithId = IncomingMessage & { requestId?: string };
```

Controller 传递：

```typescript
this.chatService.streamCompletion(payload, signal, {
  requestId: requireRequestId(request),
  userId: currentUser.id,
  source: "INTERNAL_CHAT"
});
```

只有非 HTTP 内部调用没有 request ID 时，才允许在入口边界生成 UUID。`ChatService` 和 Runtime 内部不得重新生成。

### 13.2 ChatRequestContext 扩展

```typescript
export type ChatRequestContext = {
  requestId: string;
  source: AgentRunSource;
  userId?: string;
  externalConversationId?: string;
  externalHistory?: ChatMessageDto[];
  skipInternalSessionPersistence?: boolean;
};
```

所有调用 `ChatService.createCompletion/streamCompletion` 的入口都必须显式构造该上下文。

## 14. SSE 兼容策略

第一阶段保持现有前端事件协议不变：

| RuntimeEvent          | ChatStreamEvent                           |
| --------------------- | ----------------------------------------- |
| `run_started`         | `message_start`，data 增加 `runId`        |
| `retrieval_started`   | `retrieval_start`                         |
| `retrieval_completed` | `retrieval_result`                        |
| `token`               | `token`                                   |
| `tool_started`        | `tool_call`                               |
| `tool_completed`      | `tool_result`                             |
| `run_completed`       | `message_end`，data 增加 `runId` 和 usage |
| `run_failed`          | `error`，data 增加 `runId` 和 errorType   |
| `run_canceled`        | 不再继续写响应；Run Trace 记录取消        |

现有客户端忽略未知字段，因此增加 `runId` 不需要同步破坏性升级。

## 15. 会话持久化边界

### 15.1 内部会话

`ChatService` 在调用 Runtime 前保存用户消息；只有收到 `run_completed` 后才保存完整助手消息。取消和失败不把半截输出保存成完整助手消息。

### 15.2 外部会话

`external_access` 继续负责 `ExternalConversation` 和 `ExternalMessage`，并将 `externalConversationId` 传入 Trace。Runtime 不访问外部会话表。

### 15.3 非流式与流式统一

非流式和流式都调用 `runAgent()`：

- 流式调用逐个转发事件。
- 非流式调用聚合 Token，并读取 `run_completed` 的最终结果。

移除两套独立 Tool Loop 是 Runtime 抽取完成的重要验收项。

## 16. 取消和超时

同一个 `AbortSignal` 必须贯穿：

```text
HTTP 客户端断开
-> ChatController AbortController
-> ChatService
-> AgentRuntimeService
-> RetrievalService
-> ModelProvidersService
-> ToolsService
-> future McpService
```

取消时：

1. 停止读取模型流。
2. 终止上游 HTTP 请求。
3. 不再开始新的 Tool Step。
4. 取消正在执行的 Tool。
5. 释放并发槽位。
6. 当前 Step 标记 `CANCELED`。
7. Run 标记 `CANCELED`。
8. 不持久化半截助手消息。

超时与用户取消必须区分：

- 用户或客户端断开：`CANCELED` / `canceled`。
- Runtime 总超时：`TIMED_OUT` / `run_timeout`。
- 模型阶段超时：Run `FAILED` / `model_timeout`，除非总超时同时触发。

## 17. 查询 API 与权限

V1 管理端接口：

```text
GET /agent-runs
GET /agent-runs/:runId
```

查询参数：

```text
page
pageSize
requestId
agentId
userId
source
status
errorType
createdFrom
createdTo
```

首期只允许 Admin 查询 Run Trace。后续如果开放用户查看自己的运行记录，只返回脱敏摘要，不返回 Model/Tool 输入输出详情。

Run 详情响应包含：

```text
Run 基本信息
Agent/Model 摘要
状态和耗时
Token 与成本
错误摘要
按 sequence 排序的 Step Timeline
```

## 18. 前端设计

新增：

```text
frontend/src/features/agent-runs/
  AgentRunsPage.tsx
  api.ts
  types.ts
  components/
    AgentRunTable.tsx
    AgentRunDetailDrawer.tsx
    AgentRunTimeline.tsx
    AgentRunStepDetail.tsx
```

Run 列表展示：

- 时间、Agent、用户、来源、状态。
- 输入 Preview。
- 总耗时和首 Token 延迟。
- Token、工具调用次数和错误类型。

详情按时间线展示：

```text
Run started
├── Retrieval    completed    83 ms
├── Model        completed  1.42 s
├── Tool: http   completed   320 ms
├── Model        completed  2.11 s
└── Run          completed  3.93 s
```

Step 输入输出使用 JSON Viewer 或 `pre` 展示，默认折叠并明确标识已截断、已脱敏内容。

## 19. 分阶段实施计划

### 阶段 A：Run Trace 数据层

交付：

1. Prisma 枚举和 `AgentRun`、`AgentRunStep` 表。
2. `tool_call_logs` 增加 `run_id`、`step_id`。
3. Migration 和索引。
4. `AgentRunsModule`、DTO 和状态流转 Service。
5. Service 单元测试。

本阶段不改对话行为，不增加前端入口。

### 阶段 B：在现有 ChatService 埋 Trace

交付：

1. 所有 HTTP 和外部入口统一传递 Middleware request ID。
2. 流式与非流式路径创建 Run。
3. Retrieval、Model 和 Tool 写 Step。
4. 工具日志关联 Run/Step。
5. 正确记录成功、失败、取消和超时。
6. 保持现有 SSE 事件和返回 DTO。

本阶段用于验证 Trace 信息是否足以排障。

### 阶段 C：统一 RuntimeEvent

交付：

1. `AgentRunRequest`、`AgentRuntimeEvent` 和 RuntimeError。
2. RuntimeEvent 到 ChatStreamEvent 的兼容映射。
3. 非流式接口通过聚合 RuntimeEvent 返回结果。
4. 补齐取消、部分输出失败和 Tool Round 上限测试。

### 阶段 D：抽取 AgentRuntimeService

按顺序迁移：

1. ToolDefinition 解析和可用性记录。
2. Retrieval 编排。
3. Prompt 组装到纯 `prompt-builder.ts`。
4. Model Streaming。
5. Tool Loop。
6. 流式和非流式重复逻辑。

完成后 `ChatService` 只保留输入归一化、会话、历史、消息持久化和事件映射。

### 阶段 E：Run Trace 管理端

交付：

1. Admin Run 列表和详情 API。
2. 查询权限、分页、筛选和脱敏。
3. 前端 Run 列表、详情抽屉和 Timeline。
4. 日志保留和清理命令。

## 20. 测试方案

### 20.1 AgentRunsService

- 创建 Run 后状态为 `QUEUED`。
- 合法状态流转成功。
- 终态不能被覆盖。
- `markFirstToken` 只记录第一次时间。
- Step sequence 唯一且排序稳定。
- Run 终止时活动 Step 被收敛。
- JSON 输入输出被截断和脱敏。

### 20.2 Runtime

- 无知识库、无工具的普通回答。
- 有知识库时产生 Retrieval Step。
- 一轮工具调用。
- 多轮工具调用。
- 工具不存在和参数错误。
- 模型首 Token 前失败。
- 模型输出部分 Token 后失败。
- 超过最大 Tool Round。
- 用户取消模型调用。
- 用户取消工具调用。
- Runtime 总超时。
- Trace 写入失败不影响回答。

### 20.3 Chat 兼容

- SSE 事件顺序与现有前端兼容。
- `message_start/message_end/error` 包含 runId。
- 非流式内容与流式聚合内容一致。
- 内部保留型会话正确保存完整消息。
- 取消时不保存半截助手消息。
- 外部调用不写入内部 ChatSession。

### 20.4 安全

- API Key、Authorization、Cookie 和 Secret 不进入 Trace。
- 图片 Data URL 和完整附件内容不进入 Trace。
- 非 Admin 无法查询 Run API。
- 超长工具输入输出会被截断。

## 21. 验证命令

本仓库默认使用 Node.js 22：

```bash
npm run db:validate
npm run db:generate
npm run build:api
npm run build:web
npm run typecheck
```

同时运行后端现有测试和新增 AgentRuns/Runtime 测试。每个阶段必须保持现有 Chat、Tool、Retrieval 和 External Access 测试通过。

## 22. 数据保留和清理

首期默认建议：

```text
AgentRun 和 Step：保留 90 天
FAILED/TIMED_OUT：保留 180 天
ToolCallLog：与 Run 保持一致
```

清理顺序：

1. 删除过期 AgentRun，由外键级联删除 Step。
2. 独立清理无 Run 关联的旧 ToolCallLog。
3. 清理任务记录删除数量和耗时，不记录原始内容。

V1 可以提供管理员命令手动执行，稳定后再加入每日后台任务。

手动清理命令：

```bash
npm run agent-runs:cleanup
```

可通过 `AGENT_RUN_COMPLETED_RETENTION_DAYS` 和
`AGENT_RUN_FAILED_RETENTION_DAYS` 覆盖默认的 90/180 天保留期。命令会同时删除关联
ToolCallLog 和超过普通保留期的无 Run 旧 ToolCallLog，并输出删除数量和截止时间。

## 23. 监控指标

Run Trace 落地后至少统计：

- Run 数量、成功率、失败率、取消率和超时率。
- 总耗时 P50/P95/P99。
- 首 Token 延迟 P50/P95/P99。
- Retrieval 耗时和召回数量。
- Model 错误类型和 Provider 错误率。
- Tool 调用次数、失败率和耗时。
- 输入/输出 Token。
- Trace 写入失败次数。
- 长时间停留在 `RUNNING` 的异常 Run。

需要增加恢复任务，将超过 Runtime 最大时长且仍为 `RUNNING` 的遗留 Run 标记为 `TIMED_OUT`。

## 24. 验收标准

Agent Runtime 与 Run Trace 完成必须同时满足：

1. 工作台 Chat、公开 Widget 和 Service API 复用同一 Runtime。
2. `ChatService` 不再编排 Retrieval、Model 和 Tool Loop。
3. 流式和非流式接口不再维护两套模型/工具执行流程。
4. 每次请求都有 `run_id`，并沿用入口 `request_id`。
5. Retrieval、Model、Tool 均形成独立 Step。
6. Run 和 Step 的成功、失败、取消、超时状态正确收敛。
7. `AbortSignal` 贯穿模型、工具和后续 MCP 调用边界。
8. Trace 写入失败不会导致正常模型输出失败。
9. Trace 不保存 Secret、Data URL 和无限长度输入输出。
10. 管理员可以通过 Timeline 判断故障发生在哪一步。
11. 现有 SSE 协议、会话历史和外部访问行为保持兼容。
12. 新增测试和现有 Chat、Tool、Retrieval、External Access 测试全部通过。

## 25. 后续扩展

完成本方案后：

- MCP Tool 适配进统一 `ToolsService`，自动形成 `TOOL` Step。
- Skills 在 Runtime 加载 Agent 后注入 Prompt，并记录 Skill ID 快照。
- AgentVersion 增加 `agentVersionId` 到 Run。
- Hooks 形成 `HOOK` Step。
- Subagents 使用父子 Run 关系并形成 `SUBAGENT` Step。
- Evaluation 直接以 Run 和 Step 作为评测输入。

因此，Agent Runtime 和 Run Trace 是 Mia 后续 MCP、Skills、评测和复杂 Agent 能力的共同基础，不应由各能力重复实现自己的执行链路和日志体系。

## 26. 实施状态与剩余漏项

截至阶段 E，已完成：

- Agent Runtime 单一执行入口和 Runtime Event。
- Run/Step 数据模型、状态流转、脱敏和工具日志关联。
- Admin Run 列表、详情 API、筛选分页和角色保护。
- 前端 Run 列表、详情抽屉和 Step Timeline。
- 90/180 天差异化保留及手动清理命令。

阶段 E 交付项已完成。对照第 20、23、24 节，整个 Runtime 方案仍有以下漏项：

1. Runtime 总超时尚未实现，`TIMED_OUT` 当前只有数据层状态方法。
2. 缺少模型输出部分 Token 后失败的专项测试，需确认不会重试或保存半截助手消息。
3. 缺少用户取消工具调用、多轮工具调用和 Tool Round 上限的专项测试。
4. 缺少 Trace 存储持续失败时不影响回答的专项降级测试和失败计数指标。
5. 模型 Usage 尚未从流事件完整汇总到 Run 的 Token 和成本字段。
6. 尚未实现遗留 `RUNNING` Run 的超时恢复任务。
7. 监控聚合接口和 P50/P95/P99 指标尚未实现。
8. 前端 Run Trace 页面缺少组件级自动化测试；当前由 TypeScript、生产构建和 API 测试覆盖。
