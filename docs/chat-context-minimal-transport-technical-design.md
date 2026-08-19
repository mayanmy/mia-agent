# Chat 上下文最小化传输与三层裁剪技术方案

## 1. 背景

Mia 当前通过 `historyTurns` 控制模型上下文中的最近历史轮数，默认 6 轮，可配置范围为 0～20 轮。现有两种会话模式的数据来源不同：

- `EPHEMERAL`：历史只保存在浏览器内存，前端调用 `/api/v1/chat/stream` 时提交 `history`。
- `PERSISTENT`：前端提交 `sessionId`，后端从 `chat_session_messages` 读取最近历史。

当前临时会话存在一个明显问题：前端直接将页面 `messages` 全量映射为 `history`。即使后端最终只保留 `historyTurns * 2` 条消息，浏览器仍会反复上传窗口内的全部历史。长会话可能产生以下影响：

- 请求体随会话长度线性增长，重复传输无效内容。
- 浏览器需要反复遍历和序列化数百条消息。
- NestJS 必须先接收、解析完整 JSON，之后才能裁剪。
- 请求可能触发反向代理或应用层请求体上限，返回 `413 Payload Too Large`。
- 已经不需要进入模型上下文的内容仍会扩大传输和日志误采集范围。

同时，仅依赖前端裁剪不能形成安全边界。客户端参数可以被修改，内部调用方也可能绕过 Chat HTTP 入口。因此本方案采用三层防线：

```text
前端最小化传输
  -> Chat 后端权威裁剪
    -> Agent Runtime 在模型调用前再次确认
      -> Model Providers Gateway 做最终结构校验
```

## 2. 目标与非目标

### 2.1 目标

1. 临时会话只上传模型可能使用的最近历史，不再上传页面全量消息。
2. 保留会话不由前端重复上传历史，以数据库记录作为唯一可信来源。
3. 后端始终以 Agent 的 `historyTurns` 配置为权威值，客户端不能放大上下文。
4. Agent Runtime 在调用模型前再次检查历史数量、角色、内容和预算。
5. 页面展示历史、HTTP 传输历史、模型输入历史三者相互独立。
6. 保持 SSE 事件协议、工具调用、RAG 和消息持久化行为不变。
7. 提供清晰的指标与日志，能够解释一次请求在各层裁掉了多少消息。

### 2.2 非目标

- 本期不实现长期记忆、会话摘要或语义记忆检索。
- 本期不为每个模型集成精确 tokenizer；先提供稳定的数量和字节防线。
- 本期不把历史图片、文件内容或工具过程事件重复发送给模型。
- 本期不改变 `historyTurns` 的产品含义和 0～20 的配置范围。
- 本期不改变前端 transcript 的分页、展示数量或数据库保留策略。

## 3. 核心定义

### 3.1 历史轮次

一轮历史由一条 `user` 消息开始，可带一条随后完成的 `assistant` 消息：

```text
Turn 1: user + assistant
Turn 2: user + assistant
Turn 3: user                  # 助手失败或取消时允许不完整轮次
```

裁剪必须按“用户发起的轮次”从后向前选取，不能只假定数组永远严格为 `user, assistant` 交替。具体规则：

- `user` 开始一个新轮次。
- 紧随其后的第一条有效 `assistant` 归入该轮次。
- 孤立的 `assistant` 消息丢弃。
- 连续多条 `user` 分别视为独立的不完整轮次。
- 当前正在发送的用户消息通过 `message` 单独传递，不计入 `history`。

因此，`historyTurns = 6` 表示最多选择最近 6 个用户发起的历史轮次，通常不超过 12 条历史消息，但失败场景下可能少于 12 条。

### 3.2 三种历史集合

| 集合              | 用途                  | 生命周期             | 上限来源               |
| ----------------- | --------------------- | -------------------- | ---------------------- |
| UI History        | 页面展示、滚动、复制  | 页面内存或数据库分页 | 页面性能策略           |
| Transport History | 浏览器提交给 Chat API | 单次 HTTP/SSE 请求   | 前端最小化策略         |
| Model History     | 实际进入 LLM messages | 单次 Agent Run       | 后端权威配置与模型预算 |

三者不能复用同一个“列表长度”概念。页面可以展示几百条消息，但默认只传输最近 6 轮，并且模型最终仍可能因上下文预算进一步减少历史。

## 4. 总体数据流

### 4.1 临时会话

```text
ChatPage.messages（可能数百条）
  -> buildTransportHistory(messages, agent.historyTurns)
  -> POST /api/v1/chat/stream { agentId, message, history }
  -> ChatService.normalizeHistory(history, authoritativeHistoryTurns)
  -> AgentRuntimeService.confirmModelHistory(...)
  -> system + confirmedHistory + currentUserMessage
  -> ModelProvidersService.streamChatCompletion(...)
```

### 4.2 保留会话

```text
ChatPage
  -> POST /api/v1/chat/stream { agentId, sessionId, message }
  -> ChatService 验证会话归属
  -> ChatSessionsService.buildModelHistory(sessionId, authoritativeHistoryTurns)
  -> AgentRuntimeService.confirmModelHistory(...)
  -> system + confirmedHistory + currentUserMessage
  -> ModelProvidersService.streamChatCompletion(...)
```

保留会话即使收到客户端 `history` 也必须忽略，不能混合数据库历史和客户端历史。

## 5. 第一层：前端最小化传输

### 5.1 API 契约调整

将 `history` 从必填改为可选：

```ts
export type ChatCompletionPayload = {
  agentId: string;
  sessionId?: string;
  message: string;
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  /** 仅 EPHEMERAL 模式提交。 */
  history?: ChatMessage[];
};
```

请求规则：

| 会话模式     | `sessionId` | `history`                            |
| ------------ | ----------- | ------------------------------------ |
| `EPHEMERAL`  | 不传        | 传最近限定轮次；0 轮时传 `[]` 或省略 |
| `PERSISTENT` | 必传        | 不传                                 |

### 5.2 目录与职责

新增纯函数文件：

```text
frontend/src/features/chat/utils/history.ts
```

建议接口：

```ts
type BuildTransportHistoryOptions = {
  maxTurns: number;
  maxTotalBytes: number;
};

export function buildTransportHistory(
  messages: ChatUiMessage[],
  options: BuildTransportHistoryOptions
): ChatMessage[];
```

`ChatPage` 只根据会话模式调用该函数，不在页面组件中实现裁剪算法。

### 5.3 前端裁剪规则

1. 只接受 `user`、`assistant` 角色。
2. 去除首尾空白后内容为空的消息不传输。
3. 不传输 `retrievalEvents`、`toolEvents`、UI ID、时间戳等展示字段。
4. 历史图片和文件不重复传输；附件只随本轮 `message` 发送。
5. 从后向前选取最近 `maxTurns` 个用户轮次，再恢复为时间正序。
6. 总 UTF-8 字节数超过限制时，优先删除最旧的完整轮次。
7. 不截断单条消息文本，以免悄悄改变语义；超过单条限制由后端返回明确错误。
8. `maxTurns` 在前端先夹取到 0～20，但后端不能信任该结果。

前端初始传输限制：

```text
maxTurns       = selectedAgent.historyTurns
maxTotalBytes  = 256 KiB
```

256 KiB 是 HTTP 传输保护，不代表模型上下文预算。默认 6 轮时，正常请求通常远小于该值。

### 5.4 当前实现的状态约束

当前 `ChatUiMessage` 没有显式的 `pending | streaming | completed | failed | canceled` 字段。现有发送流程在构造 `history` 后才把本轮用户消息和空助手占位加入 `messages`，因此本轮消息不会误入历史；空助手内容也会被过滤。

第一阶段可以在不扩展状态模型的前提下完成最小化传输。后续如果需要保留失败或取消的部分回答，再为 `ChatUiMessage` 增加状态，并规定只有 `completed` 助手消息进入历史。

### 5.5 前端调用示例

```ts
const history =
  selectedAgent?.chatSessionMode === "EPHEMERAL"
    ? buildTransportHistory(messages, {
        maxTurns: selectedAgent.historyTurns,
        maxTotalBytes: 256 * 1024
      })
    : undefined;

await streamChatCompletion({
  agentId: selectedAgentId,
  sessionId: sessionId ?? undefined,
  message: content,
  images: currentImages,
  files: currentFiles,
  ...(history ? { history } : {})
});
```

## 6. 第二层：Chat 后端权威裁剪

### 6.1 权威配置来源

`ChatService` 必须先通过 `AgentsService.getAgentRuntimeConfig(agentId)` 取得真实 `historyTurns`。禁止接受客户端传入的 `historyTurns`，也不能根据 `history.length` 推断配置。

历史来源固定为：

```text
context.externalHistory 存在
  -> 清洗 externalHistory
否则 sessionId 存在
  -> 从 ChatSessionsService 查询数据库历史
否则
  -> 清洗 payload.history
```

HTTP 持久会话路径不得使用 `payload.history`。外部访问路径必须继续经过独立会话归属和历史数量限制。

### 6.2 建议统一的裁剪函数

把当前只做 `slice(-maxTurns * 2)` 的逻辑提取为 Chat 模块内的纯函数：

```text
backend/src/modules/chat/history-policy.ts
```

建议接口：

```ts
type HistoryPolicy = {
  maxTurns: number;
  maxMessages: number;
  maxMessageBytes: number;
  maxTotalBytes: number;
};

type HistorySanitizeResult = {
  messages: AgentRuntimeHistoryMessage[];
  receivedMessages: number;
  acceptedMessages: number;
  droppedMessages: number;
  acceptedBytes: number;
  reasons: Partial<Record<HistoryDropReason, number>>;
};
```

统一函数供以下入口复用：

- `payload.history` 临时会话历史。
- `context.externalHistory` 外部调用历史。
- `ChatSessionsService.buildModelHistory()` 查询后的数据库历史。

### 6.3 后端初始硬限制

```text
maxTurns         = min(max(agent.historyTurns, 0), 20)
maxMessages      = maxTurns * 2
maxMessageBytes  = 32 KiB
maxTotalBytes    = 256 KiB
allowedRoles     = user, assistant
```

处理原则：

- 非法角色、空内容、非字符串内容直接拒绝或丢弃，并记录原因。
- 单条历史超过 32 KiB 返回稳定的 `400 CHAT_HISTORY_MESSAGE_TOO_LARGE`。
- 请求历史总量超过 256 KiB 时，从最旧轮次开始丢弃，保留最近上下文。
- 数据库读取使用 `historyTurns * 2` 作为查询上限，避免先读取全量记录。
- 处理后始终恢复为时间正序。
- 当前用户消息、图片、文件使用现有独立校验，不计入 `history` 限额。

对于 HTTP 客户端提交的结构错误，建议返回明确错误；对于数量和总量超限，服务端可安全裁剪而不失败。这样既能防止滥用，也不会因为旧前端仍提交全量历史而中断升级。

### 6.4 兼容旧前端

发布顺序必须先后端、后前端：

1. 后端先部署统一裁剪和可选 `history` 契约，继续兼容旧前端全量提交。
2. 前端再部署最小化传输。
3. 观察旧版本请求比例和裁剪指标。
4. 确认全部前端升级后，再考虑收紧请求总大小或错误策略。

## 7. 第三层：模型调用前再次确认

### 7.1 为什么需要第三层

`AgentRuntimeService` 是 Chat、外部访问以及未来 Job/Subagent 的统一运行入口。即使 Chat HTTP 入口已经裁剪，其他内部调用方仍可能直接构造 `AgentRunRequest.history`。因此 Runtime 必须在拼装 LLM messages 前重新加载 Agent 配置并确认历史。

当前 Runtime 已在 `runAgent()` 开始时调用 `AgentsService.getAgentRuntimeConfig()`，具备获取权威 `historyTurns` 的条件。

### 7.2 Runtime 确认流程

在构造：

```ts
const messages = [systemMessage, ...request.history, currentUserMessage];
```

之前增加：

```ts
const confirmedHistory = confirmModelHistory(request.history, {
  maxTurns: agent.historyTurns,
  maxHistoryBytes: MAX_MODEL_HISTORY_BYTES
});
```

Runtime 再次确认：

1. 角色只能是 `user` 或 `assistant`，防止客户端注入 `system`、`tool`。
2. 内容必须是非空字符串。
3. 历史轮数不能超过当前 Agent 配置。
4. 历史消息顺序保持稳定。
5. 模型历史字节预算不能超过 Runtime 上限。
6. 最终 `messages` 必须恰好包含一个由 Runtime 构建的 system message 和一个本轮 user message。

第三层不是简单重复代码。第二层负责 HTTP/会话领域的可信来源和错误反馈，第三层负责所有 Runtime 调用方的模型安全不变量。

### 7.3 模型上下文预算

传输上限不能代替模型 Token 预算。建议分两期实现：

#### v1：稳定字节保护

```text
MAX_MODEL_HISTORY_BYTES = 64 KiB
```

从最新轮次向前累计，超过预算时删除最旧完整轮次。64 KiB 只作为防止极端输入的保守保护；实际历史通常先受 0～20 轮限制。

#### v1.1：按模型上下文窗口计算

为 `ModelRuntimeConfig` 增加稳定字段：

```ts
contextWindowTokens: number;
```

模型输入预算计算为：

```text
availableInputTokens
  = contextWindowTokens
  - reservedOutputTokens
  - systemPromptTokens
  - toolDefinitionTokens
  - ragContextTokens
  - safetyMarginTokens
```

裁剪顺序：

1. 保留当前用户消息。
2. 保留 system prompt 的必要部分。
3. 按 Retrieval 策略裁剪 RAG chunks。
4. 从最旧轮次开始删除历史。
5. 工具循环产生的本轮 tool messages 不与跨轮历史混合裁剪。

只有在获得模型明确的 `contextWindowTokens` 和可靠 tokenizer 后，才能把字节估算替换为精确 Token 预算。未知模型必须保留安全余量，不能假定 OpenAI tokenizer 适用于所有供应商。

### 7.4 Provider Gateway 最终校验

`ModelProvidersGateway.requireMessages()` 继续承担协议层结构校验：

- `messages` 非空。
- role 属于 `system | user | assistant | tool`。
- content 结构合法。
- Provider Client 只接收规范化后的 DTO，不接收 Chat 原始请求。

Gateway 不负责理解 `historyTurns`，避免 `model_providers` 反向依赖 Chat 或 Agent 业务语义。

## 8. 错误模型

建议新增稳定错误码：

| 错误码                           | HTTP | 含义                                   |
| -------------------------------- | ---- | -------------------------------------- |
| `CHAT_HISTORY_INVALID`           | 400  | 历史结构、角色或内容类型非法           |
| `CHAT_HISTORY_MESSAGE_TOO_LARGE` | 400  | 单条历史文本超过 32 KiB                |
| `CHAT_HISTORY_PAYLOAD_TOO_LARGE` | 413  | Chat 请求整体超过应用硬上限            |
| `CHAT_HISTORY_POLICY_VIOLATION`  | 500  | 内部调用绕过策略，Runtime 最终校验失败 |

外部 HTTP 输入导致的问题返回 4xx；内部 Runtime 不变量被破坏时记录 `request_id`、调用来源和消息统计，但不能记录完整消息正文。

## 9. 可观测性

每次 Agent Run 建议记录以下统计字段：

```ts
type HistoryPolicyMetrics = {
  source: "client" | "session" | "external";
  configuredTurns: number;
  receivedMessages: number;
  backendAcceptedMessages: number;
  runtimeAcceptedMessages: number;
  receivedBytes: number;
  modelHistoryBytes: number;
  droppedByCount: number;
  droppedByBytes: number;
};
```

要求：

- 普通日志只记录数量、字节数和裁剪原因。
- 不记录完整历史正文。
- 所有指标关联 `request_id`、`agent_id`、`session_id` 和调用来源。
- Runtime 再次裁剪到比 Chat 层更少时记录 warning，便于发现入口策略不一致。
- 可统计 `receivedMessages / backendAcceptedMessages`，验证前端最小化传输是否生效。

## 10. 安全与隐私

- 后端只信任 Agent Runtime 配置，不信任客户端声明的轮数。
- 客户端不能提交 `system` 或 `tool` 历史，避免 Prompt 和工具结果注入。
- 保留会话只读取当前用户拥有且与 Agent 匹配的 `sessionId`。
- 历史正文不得进入访问日志、异常堆栈和普通指标标签。
- 前端裁剪减少无效数据暴露，但不能作为隐私或权限控制边界。
- 请求体总大小仍需由 Nginx 与 NestJS 统一限制；附件上传上限应与 JSON 历史上限分别配置。

## 11. 实施步骤

### 阶段一：后端权威裁剪

1. 新增 `chat/history-policy.ts` 纯函数及单元测试。
2. 让临时历史、外部历史和数据库历史统一经过策略。
3. 增加单条与总字节限制、稳定错误码和统计字段。
4. 保持 `history?: ChatMessageDto[]` 向后兼容。

验收：即使客户端提交 500 条历史，Chat Service 也只向 Runtime 传递配置允许的最近轮次；非法 `system` 历史不能进入 Runtime。

### 阶段二：Runtime 再确认

1. 在 `AgentRuntimeService` 构建 `messages` 前重新确认历史。
2. 增加 64 KiB 模型历史保护。
3. Runtime 裁剪结果写入 run trace 统计。
4. Provider Gateway 保留现有结构校验。

验收：测试直接向 `runAgent()` 传入超额或非法历史，模型客户端仍不会收到越权消息。

### 阶段三：前端最小化传输

1. 将 `ChatCompletionPayload.history` 改为可选。
2. 新增 `buildTransportHistory()` 纯函数。
3. 临时模式只传最近轮次；保留模式不传 `history`。
4. 在浏览器 Network 面板验证长会话请求体保持稳定。

验收：页面有 500 条消息、Agent 配置 6 轮时，请求最多携带最近 6 个历史轮次；持久模式请求中不存在 `history` 字段。

### 阶段四：精确 Token 预算（后续）

1. 扩展模型运行时配置的上下文窗口字段。
2. 为支持的 Provider 引入匹配 tokenizer 或供应商计数能力。
3. 统一 System、RAG、Tools、History 和 Output 的预算分配。

## 12. 测试方案

### 12.1 前端纯函数

- 默认 6 轮只返回最近 6 个用户轮次。
- `historyTurns = 0` 返回空数组。
- 超过 20 自动夹取到 20。
- 空助手占位被过滤。
- 孤立助手被丢弃。
- 连续用户消息按独立轮次处理。
- 超过总字节限制时优先删除最旧完整轮次。
- 不携带图片、文件、检索事件和工具事件。
- 输入数组不被原地修改。

### 12.2 Chat Service

- 临时会话使用客户端历史并按 Agent 配置裁剪。
- 持久会话忽略客户端历史，只读取数据库记录。
- 数据库查询数量不超过 `historyTurns * 2`。
- 客户端提交 `system` / `tool` 角色被拒绝。
- 单条超限返回稳定 400。
- 500 条旧前端历史被安全裁剪，而不是全部传入 Runtime。
- `historyTurns = 0` 时任何来源均得到空历史。

### 12.3 Agent Runtime

- 绕过 Chat Service 直接传入超额历史仍被再次裁剪。
- 非法角色不能进入模型 Provider。
- `messages` 顺序为 system、历史、本轮 user。
- RAG 和工具调用启用后，历史限制仍然生效。
- 工具循环追加的本轮 assistant/tool 消息不被误当成跨轮历史删除。

### 12.4 端到端与性能

- 临时会话构造 500 条 UI 消息，Network 请求仍保持固定上限。
- 保留会话翻页加载到 500 条后，SSE 请求只包含 `sessionId` 和本轮输入。
- 慢网环境下请求延迟不随页面历史条数线性增长。
- SSE 取消、超时和模型失败行为与改造前一致。

## 13. 发布、灰度与回滚

### 13.1 发布顺序

```text
后端权威裁剪
  -> Runtime 再确认
    -> 前端最小化传输
```

该顺序保证旧前端可以继续工作，新前端也不会依赖尚未部署的后端行为。

### 13.2 灰度观察

重点观察：

- Chat 请求平均与 P95 body size。
- `receivedMessages` 和 `backendAcceptedMessages` 的差值。
- `413`、历史校验 400 和模型上下文超限错误率。
- 首 Token 延迟是否下降。
- Runtime 二次裁剪 warning 是否持续出现。

### 13.3 回滚

- 前端可独立回滚到全量传输，后端仍能安全裁剪。
- Runtime 再确认属于安全防线，原则上不回滚；如策略误判，只调整预算或轮次算法。
- 本方案第一阶段不涉及数据库迁移，回滚不影响现有会话数据。

## 14. 验收标准

方案完成必须同时满足：

1. `EPHEMERAL` 页面无论展示多少消息，传输历史都不超过 Agent 配置轮数和 256 KiB。
2. `PERSISTENT` 请求不提交 `history`，模型历史只来自已验证会话。
3. Chat Service 使用权威 `historyTurns`，客户端不能扩大上限。
4. Agent Runtime 在模型调用前重新确认角色、轮数和 64 KiB 模型历史预算。
5. Provider Client 收不到客户端注入的 `system` 或 `tool` 历史。
6. 默认配置仍保持 6 轮，最大仍保持 20 轮。
7. SSE、RAG、工具调用、取消和日志主流程无行为回归。
8. TypeScript typecheck、前后端 build 和新增测试全部通过。
