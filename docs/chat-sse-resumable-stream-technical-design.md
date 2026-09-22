# Mia Chat SSE 断线续流技术设计

## 1. 文档状态

- 状态：已实现
- 适用版本：Mia v0.1 单实例部署
- 所属模块：后端 `chat`、前端 `features/chat`
- 续流范围：同一页面生命周期内的短时网络中断
- 默认断线宽限期：60 秒
- 终态流保留时间：10 分钟

## 2. 背景

旧 Chat 流式接口把一次模型生成直接绑定到一个 HTTP SSE 连接：

```text
POST /api/v1/chat/stream
  -> HTTP SSE 连接
  -> ChatService.streamCompletion
  -> 上游 LLM stream
```

浏览器网络切换、反向代理重连或短时弱网会关闭 HTTP 连接。旧接口检测到连接关闭后会立即取消上游模型，因此已经生成但客户端尚未收到的内容无法补发，用户只能重新提问。

本方案将“模型生成任务”和“SSE 订阅连接”解耦。生成任务拥有独立 `streamId` 和短期事件缓冲，客户端记录最后确认的事件 ID；连接恢复后从该游标继续订阅。

## 3. 目标与非目标

### 3.1 目标

1. 网络短暂断开后自动恢复同一次模型生成。
2. 重连时只补发客户端尚未消费的事件。
3. 重复收到同一事件时不重复追加 Token 或执行 UI 状态变更。
4. 用户主动停止、切换 Agent、切换会话或离开页面时立即取消上游调用。
5. 断线超过宽限期后取消无人消费的模型任务，避免继续产生费用。
6. 保持现有 Chat SSE 事件类型和消息持久化逻辑不变。
7. 保留旧 `POST /api/v1/chat/stream`，给尚未迁移的调用方兼容使用。

### 3.2 非目标

- 不支持服务进程重启后的恢复。
- 不支持浏览器刷新或关闭后恢复原流。
- 不支持跨后端实例续流。
- 不将事件缓冲写入 PostgreSQL。
- 不保证因终端休眠、断网超过 60 秒导致的长时间恢复。
- 不替代最终消息持久化；事件缓冲只服务于传输恢复。
- 不自动重试一轮已经进入终态的模型调用。

## 4. 核心语义

必须区分“被动断线”和“主动取消”：

| 场景 | 客户端行为 | 服务端行为 |
| --- | --- | --- |
| 网络波动、连接 EOF、读取异常 | 保留 `streamId` 和游标，自动重连 | 生成继续，启动 60 秒断线宽限期 |
| 用户点击停止 | 调用取消接口并中止本地读取 | 立即取消上游 LLM |
| 切换 Agent 或会话 | 调用取消接口，清理旧 UI 状态 | 立即取消旧流 |
| 离开 Chat 页面 | 调用取消接口并中止本地读取 | 立即取消旧流 |
| 收到 `message_end` | 结束重连循环 | 标记 `completed`，保留事件 10 分钟 |
| 收到 `error` | 展示错误并结束重连循环 | 标记 `failed` 或 `canceled` |
| 60 秒内无订阅者 | 不再重连 | 取消上游，生成 `canceled` 终态 |

主动取消不能只执行浏览器 `AbortController.abort()`。它还必须调用服务端取消接口，否则服务端会把它当作临时网络断线并继续生成 60 秒。

## 5. 总体架构

```text
ChatPage
  -> POST /api/v1/chat/streams
       -> ChatStreamsService.createStream
       -> 创建 stream runtime
       -> 异步运行 ChatService.streamCompletion
       -> 返回 streamId + reconnectWindowMs

  -> GET /api/v1/chat/streams/:streamId/events?after=0
       -> 校验当前用户拥有该 stream
       -> 回放 id > after 的缓冲事件
       -> 持续推送新事件

  X 网络断开

  -> GET /api/v1/chat/streams/:streamId/events?after=lastEventId
       -> 只补发缺失事件
       -> 接回实时事件

用户停止
  -> DELETE /api/v1/chat/streams/:streamId
       -> AbortController.abort
       -> 取消上游 LLM stream
```

`ChatStreamsService` 只负责流生命周期、事件游标、短期缓冲、订阅和取消。实际对话编排仍由 `ChatService` 完成，模块边界不变：

```text
ChatStreamsService
  -> ChatService
    -> Agent Runtime / Retrieval / Model Provider / Tools / Logs
```

## 6. HTTP API 协议

所有接口都需要现有登录鉴权和 Workspace 上下文。

### 6.1 创建生成任务

```http
POST /api/v1/chat/streams
Content-Type: application/json
Authorization: Bearer <access-token>

{
  "agentId": "agent-id",
  "sessionId": "optional-session-id",
  "message": "你好",
  "history": []
}
```

响应：

```json
{
  "streamId": "c7b9c095-0ae8-4d3a-8871-c6c6dcf54d04",
  "reconnectWindowMs": 60000
}
```

创建接口返回后，模型任务已经与创建请求解耦。若客户端尚未来得及订阅就断开，任务同样受 60 秒宽限期约束。

### 6.2 订阅或恢复事件

```http
GET /api/v1/chat/streams/{streamId}/events?after={lastEventId}
Accept: text/event-stream
Authorization: Bearer <access-token>
```

`after` 语义是排他游标：服务端只返回 `id > after` 的事件。缺失、负数、非安全整数按 `0` 处理。

响应 Headers：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

业务事件示例：

```text
id: 17
event: token
data: {"content":"你好"}

id: 18
event: message_end
data: {"content":"你好，很高兴见到你。"}

```

每个可恢复业务事件必须包含 `id`。ID 在单个 `streamId` 内从 1 开始严格递增，不要求跨流全局唯一。

心跳事件每 15 秒发送一次，不写入事件缓冲，也不包含 ID：

```text
event: ping
data: {"ts":1787562000000}

```

因此 `ping` 不推进续流游标。

### 6.3 主动取消

```http
DELETE /api/v1/chat/streams/{streamId}
Authorization: Bearer <access-token>
```

成功返回 `null`。运行中的任务收到 `user_canceled` Abort 信号；已进入终态的任务不重复取消。

### 6.4 访问控制

流运行时保存创建用户的 `userId`。订阅和取消都必须同时匹配 `streamId` 与当前用户。

不存在和不属于当前用户统一返回 404，避免通过 stream ID 探测其他成员的运行状态。订阅接口必须在发送 SSE Headers 之前完成归属校验，否则全局异常过滤器无法再返回标准 JSON 错误。

## 7. 服务端设计

### 7.1 运行时数据结构

每个活动流维护：

```typescript
type ChatStreamRuntime = {
  id: string;
  userId: string;
  payload: ChatCompletionDto;
  context: ChatRequestContext;
  status: "running" | "completed" | "failed" | "canceled";
  abortController: AbortController;
  events: StoredChatStreamEvent[];
  nextEventId: number;
  version: number;
  subscribers: number;
  waiters: Set<() => void>;
  disconnectTimer?: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
};
```

当前通过进程内 `Map<streamId, runtime>` 保存。事件只在内存中存在，不是业务消息的权威存储。

### 7.2 事件写入

`ChatService.streamCompletion` 产生的所有业务事件依次进入缓冲：

```text
ChatStreamEvent
  -> 分配 nextEventId
  -> events.push
  -> version + 1
  -> 唤醒所有等待订阅者
```

终态判断：

- `message_end` -> `completed`
- `error.data.errorType === canceled` -> `canceled`
- 其他 `error` -> `failed`
- 上游无终态直接结束 -> 合成 `error` 事件
- 抛出异常 -> 转换为 `error` 事件

终态后事件保留 10 分钟，允许连接在最终事件发送前断开时再次补取。到期后删除整个 runtime。

### 7.3 订阅与回放

订阅者维护本地 `cursor`：

```text
读取 events 中 id > cursor 的事件
  -> 依次 yield
  -> cursor 前移
  -> 重新扫描事件缓冲
  -> 无新事件且仍 running 时等待通知
  -> 终态且无待发事件时结束 SSE
```

每次 `yield` 都会把控制权交给 HTTP 写入端。写入期间可能新增 Token，因此消费过任何事件后必须重新扫描缓冲，不能直接根据旧快照进入等待。

### 7.4 等待通知的竞态控制

“确认没有新事件”和“注册 waiter”之间存在竞态：

```text
订阅者检查：无事件
生产者追加事件并通知
订阅者注册 waiter
订阅者永久等待
```

服务端使用 `version` 解决：

1. 订阅者记录 `observedVersion`。
2. 注册 waiter。
3. 注册后再次比较版本和状态。
4. 版本已变化时立即解除 waiter 并重新扫描。

这保证事件通知不会丢失。

### 7.5 订阅者与宽限期

- 第一个订阅者进入时取消断线计时器。
- 每个订阅者退出时减少计数。
- `running` 且订阅者数量变为 0 时启动 60 秒计时器。
- 60 秒内重新订阅会取消计时器，生成任务继续。
- 到期仍无订阅者时取消上游模型。
- 定时器调用 `unref`，不能阻止 Node.js 进程正常退出。

服务关闭时取消全部运行任务、唤醒 waiter、清理计时器和 Map。

## 8. 前端设计

### 8.1 两阶段请求

`streamChatCompletion` 首先创建任务，然后进入订阅循环：

```text
create stream
  -> onStreamCreated(streamId)
  -> lastEventId = 0
  -> GET events?after=0
  -> 消费事件并更新 lastEventId
```

`ChatPage` 将 `streamId` 保存到 `activeStreamIdRef`，用于主动停止和页面生命周期清理。

### 8.2 SSE 解析与去重

前端解析每个 SSE 块的 `id:`、`event:` 和多行 `data:`。业务事件处理前执行：

```text
eventId <= lastEventId
  -> 丢弃重复事件

eventId > lastEventId
  -> 更新 lastEventId
  -> 调用 onEvent
```

即使代理或服务端重复发送已确认事件，也不会重复追加 Token、工具卡片或检索结果。

畸形 JSON 转换成前端 `error` 事件并终止本轮流，不对消费回调异常执行网络重试。

### 8.3 自动重连

以下情况视为可重试连接故障：

- `fetch` 网络失败。
- `ReadableStream` 读取异常。
- SSE 在没有 `message_end` 或 `error` 的情况下 EOF。
- 响应没有可读 body。

重连请求携带最后已消费事件 ID：

```text
GET /events?after={lastEventId}
```

退避策略：

```text
第 1 次：500ms
第 2 次：1000ms
第 3 次：2000ms
第 4 次：4000ms
后续：5000ms
```

重试不能超过创建接口返回的 `reconnectWindowMs` 截止时间。

以下情况不重试：

- 用户 Abort。
- 订阅接口返回非 2xx，例如 401、403、404。
- `onEvent` 业务消费逻辑抛错。
- 已收到 `message_end` 或 `error`。
- 超过续流截止时间。

### 8.4 与 Token 批处理配合

断线续流负责传输可靠性，Token 批处理负责降低 React 更新频率，二者职责独立：

```text
SSE 游标去重
  -> onEvent(token)
  -> Token Buffer
  -> requestAnimationFrame / 50ms 兜底
  -> React 状态更新
```

`message_end.content` 仍是最终权威正文。收到终态时清空尚未刷新的增量，并用最终正文覆盖本地流式内容。

### 8.5 主动生命周期清理

以下操作调用 `cancelChatStream(streamId)`，随后中止本地读取：

- 点击停止生成。
- 切换 Agent。
- 切换会话。
- 返回 Agent 列表。
- Chat 页面卸载。

取消接口采用尽力而为模式：即使取消请求本身失败，本地 UI 仍立即停止；服务端最终由 60 秒无人订阅保护机制止损。

## 9. 时序

### 9.1 正常完成

```text
Browser                 ChatController       ChatStreamsService       ChatService/LLM
   | POST /streams             |                     |                       |
   |-------------------------->| createStream        |                       |
   |                           |-------------------->| streamCompletion      |
   |<------ streamId ----------|                     |---------------------->|
   | GET /events?after=0       |                     |                       |
   |-------------------------->| subscribe           |                       |
   |<-- id:1 message_start ----|<--------------------|                       |
   |<-- id:2 token ------------|<--------------------|<----------------------|
   |<-- id:3 message_end ------|<--------------------|<----------------------|
   |          SSE end          |                     | completed + TTL       |
```

### 9.2 断线恢复

```text
Browser                 ChatStreamsService       LLM
   |<-- id:10 token -----------|                  |
   |       network lost        |                  |
   X                           |<-- token 11 -----|
                               |<-- token 12 -----|
                               | events buffered  |
   | GET events?after=10       |                  |
   |-------------------------->|                  |
   |<-- id:11 token -----------|                  |
   |<-- id:12 token -----------|                  |
   |<-- live id:13 token ------|<-- token 13 -----|
```

### 9.3 用户主动停止

```text
Browser                 ChatStreamsService       LLM
   | DELETE /streams/:id       |                  |
   |-------------------------->| abort             |
   | local reader abort        |----------------->X|
   | UI status = stopped       | canceled event    |
```

## 10. 异常与边界处理

| 异常 | 处理 |
| --- | --- |
| 创建请求失败 | 不生成 `streamId`，前端直接展示错误 |
| 创建成功但响应在客户端收到前丢失 | 服务端等待 60 秒后取消无人订阅任务 |
| 订阅过程中断 | 前端使用最后游标重连 |
| 相同事件重复到达 | 前端按 `eventId` 丢弃 |
| 游标大于当前最大事件 ID | 等待后续新事件；不会回退游标 |
| 重连时流已终态 | 回放游标后的终态事件并关闭连接 |
| 重连时流已清理 | 返回 404，前端停止重试并展示错误 |
| 上游异常退出但没有 error 事件 | 服务端合成统一 error 终态 |
| 用户取消请求丢失 | 本地立即停止，服务端 60 秒后兜底取消 |
| 服务关闭 | 取消全部上游任务；当前 v0.1 无法跨重启恢复 |

## 11. 部署要求

Nginx 或其他反向代理必须：

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 180s;
gzip off;
```

应用响应已经设置 `X-Accel-Buffering: no`，但生产代理仍应显式关闭 SSE 缓冲。`proxy_read_timeout` 应大于 15 秒心跳间隔和模型允许的 Token 空闲时间。

当前实现只适合单实例或保证同一 `streamId` 始终路由到原实例的部署。若直接水平扩容且没有粘性路由，创建请求和订阅请求可能落到不同实例并返回 404。

## 12. 可观测性建议

当前沿用创建流时的 `requestId` 贯穿原有 Chat、模型、检索、工具和日志链路。后续建议增加以下指标：

- `chat_stream_created_total`
- `chat_stream_reconnect_total`
- `chat_stream_replay_event_total`
- `chat_stream_disconnect_grace_expired_total`
- `chat_stream_active`
- `chat_stream_buffered_events`
- `chat_stream_duration_ms`
- `chat_stream_terminal_total{status}`

日志至少应包含：

```text
request_id
stream_id
user_id
agent_id
session_id
last_event_id
replay_count
disconnect_duration_ms
terminal_status
```

日志不得记录附件原文、完整 Prompt、API Key 或未经脱敏的工具参数。

## 13. 测试方案与现状

已实现的服务端单元测试：

1. 首次订阅读取部分事件后断开。
2. 生成任务在无连接期间继续产生事件。
3. 使用最后游标恢复时只返回缺失事件。
4. 事件 ID 和顺序保持一致。
5. 用户主动停止后上游收到 Abort，订阅收到 canceled 终态。

实现过程中额外覆盖了一个关键竞态：订阅者 `yield` 一个事件期间新 Token 到达，恢复执行后必须重新扫描事件列表，不能基于旧快照进入 waiter。

当前验证结果：

```text
backend: 162/162 tests passed
frontend: TypeScript + Vite production build passed
```

后续建议增加端到端测试：

1. 在浏览器读取若干 Token 后强制关闭网络连接，再恢复网络。
2. 验证最终正文与无断线基线完全一致。
3. 验证工具事件和检索事件不会重复渲染。
4. 验证断线超过 60 秒后停止续流。
5. 验证切换会话和页面卸载会立即取消上游。
6. 验证 Nginx 环境中事件不被缓冲。

## 14. 已知限制与 Redis 演进

### 14.1 当前限制

- runtime 和事件缓冲随进程退出而丢失。
- 页面刷新后前端没有持久化 `streamId` 和 `lastEventId`。
- 事件数组在终态 TTL 前保留完整流事件，没有独立内存上限。
- 多实例部署需要粘性路由，否则无法找到原实例 runtime。

以 Mia 当前 20-50 人、单实例、本地部署的容量目标，内存方案优先保证实现简单和故障边界清晰。

### 14.2 多实例演进方案

需要水平扩容或跨重启恢复时，将运行时拆为：

```text
Redis Hash
  chat:stream:{streamId}:meta
  -> owner/status/requestId/lastEventId/expireAt

Redis Stream
  chat:stream:{streamId}:events
  -> eventId/type/data

Pub/Sub 或阻塞读取
  -> 唤醒订阅实例

分布式任务所有权
  -> 标记真正持有上游 LLM 连接的 worker
```

迁移时必须解决：

1. 创建任务与事件写入的原子性。
2. 单个生成任务只能由一个 worker 持有。
3. Worker 崩溃后的租约和任务终态处理。
4. Redis Stream 裁剪不能早于最大重连窗口。
5. 取消命令跨实例传递到任务所有者。
6. `requestId`、`streamId` 和 Run Trace 的统一关联。
7. 页面刷新恢复时的安全存储、会话归属和 UI 重建。

在出现明确的多实例或跨刷新恢复需求前，不建议提前引入 Redis 和分布式租约。

## 15. 代码位置

```text
backend/src/modules/chat/chat-streams.service.ts
backend/src/modules/chat/chat-streams.service.spec.ts
backend/src/modules/chat/chat.controller.ts
backend/src/modules/chat/chat.module.ts
backend/src/test/run-tests.ts

frontend/src/features/chat/api.ts
frontend/src/features/chat/ChatPage.tsx
frontend/src/features/chat/hooks/useTokenBuffer.ts
```

相关文档：

- `docs/chat-frontend-token-batching-technical-design.md`
- `docs/chat-session-history-technical-design.md`
- `docs/chat-context-minimal-transport-technical-design.md`
- `docs/baota-nginx-deployment.md`

