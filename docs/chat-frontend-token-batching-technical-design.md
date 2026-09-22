# Mia Chat 前端 Token 批处理技术方案

## 1. 背景

Mia Chat 当前通过 `fetch + ReadableStream` 消费 SSE。每收到一个 `token` 事件，前端都会立即调用一次 `setMessages`，遍历消息数组并更新当前 Assistant 消息。消息更新还会触发 Markdown 重新解析和自动滚动调度。

当前链路：

```text
SSE token
  -> onEvent
  -> appendAssistantToken
  -> setMessages
  -> messages.map
  -> ReactMarkdown
  -> useAutoScroll
```

模型输出粒度较小时，这条链路会在短时间内产生大量 React 更新。回答越长、Markdown 结构越复杂，主线程压力越明显。

## 2. 目标与非目标

### 2.1 目标

1. 将多个连续 Token 合并为一次 React 状态更新。
2. 前台页面每个动画帧最多刷新一次 Token 内容。
3. 后台标签页中即使 `requestAnimationFrame` 被降频，也能在最大等待时间内刷新。
4. `message_end`、错误、停止和组件卸载时不丢失、不重复追加内容。
5. 保持现有 SSE 协议、后端接口和最终消息持久化逻辑不变。
6. 保持首 Token 耗时统计基于“收到首个 Token”的时间，而不是 UI 首次刷新的时间。

### 2.2 非目标

- Token 批处理本身不负责 SSE 断线续流；续流已经作为独立传输层能力实现，详见 `docs/chat-sse-resumable-stream-technical-design.md`。
- 不修改后端 Token 事件的生成和合并策略。
- 不修改消息数据库结构。
- 不引入 Redux、Zustand 等全局状态库。
- 不在本阶段重写 Markdown 渲染器。
- 不改变用户主动停止生成时取消上游请求的行为。

## 3. 设计原则

- 传输与渲染解耦：SSE 仍逐事件解析，只有 UI 更新批量执行。
- 最终内容权威：收到 `message_end.content` 时，以服务端最终正文覆盖本地流式正文。
- 明确终态：完成、错误、停止和卸载分别定义缓冲区处理规则。
- 单流单缓冲：每次发送只维护当前 Assistant 消息的 Token 缓冲，不提前抽象多流并发。
- 渐进优化：先降低状态更新频率，再根据性能测量决定是否优化 Markdown 和历史消息渲染。

## 4. 总体方案

新增 Chat feature 私有 Hook：

```text
frontend/src/features/chat/hooks/useTokenBuffer.ts
```

处理链路调整为：

```text
SSE token
  -> 立即记录首 Token 时间
  -> append(messageId, delta)
  -> 写入内存 buffer
  -> requestAnimationFrame 或 50ms 定时兜底
  -> 合并为一个 delta
  -> appendAssistantToken
  -> 一次 setMessages
```

Token 缓冲只保存尚未提交给 React 状态的增量，不保存完整消息正文。完整正文继续由 `messages` 状态管理。

## 5. Hook 接口

建议接口：

```typescript
type TokenBatch = {
  messageId: string;
  content: string;
};

type UseTokenBufferOptions = {
  maxWaitMs?: number;
  maxBufferChars?: number;
  onFlush: (batch: TokenBatch) => void;
};

type UseTokenBufferResult = {
  append: (messageId: string, content: string) => void;
  flush: () => void;
  clear: () => void;
};
```

职责：

- `append`：追加 Token，并安排下一次刷新。
- `flush`：同步取出当前批次，取消已安排的刷新任务并调用 `onFlush`。
- `clear`：丢弃未刷新的 Token，取消已安排的刷新任务，不调用 `onFlush`。
- Hook 卸载：执行 `clear`，避免卸载后更新 React 状态。

`append` 接受 `messageId`，用于防止上一条流的延迟任务把 Token 写入下一条消息。如果缓冲区中已经存在另一个 `messageId`，应先刷新旧缓冲，再接收新消息。

## 6. 调度策略

默认参数：

```text
前台刷新：requestAnimationFrame
最大等待：50ms
最大缓冲：4096 字符
```

同时安排 `requestAnimationFrame` 和最大等待定时器：

```text
首次 append
  -> 安排 requestAnimationFrame
  -> 安排 50ms timeout

任一任务先执行
  -> 取消另一个任务
  -> flush
```

原因：浏览器后台标签页可能暂停或大幅降低 `requestAnimationFrame` 频率，仅依赖动画帧会导致内容长时间不更新。

当缓冲字符数达到 `maxBufferChars` 时立即 `flush`，避免单次服务端事件异常过大时积压内存。

## 7. SSE 事件处理规则

### 7.1 token

```text
首次 token
  -> 立即记录 firstTokenMs

所有 token
  -> tokenBuffer.append(assistantMessageId, content)
```

首 Token 时间不能放在 `onFlush` 中，否则统计会多出浏览器调度等待时间。

### 7.2 message_end

当前后端的 `message_end.content` 是最终权威正文，可能与中间 Token 不完全相同，例如 Workflow End 节点可能转换最终结果。因此处理顺序为：

```text
tokenBuffer.clear()
replaceAssistantContent(messageId, message_end.content)
updateAssistantGeneration(messageId, completed)
更新运行元数据和持久化消息 ID
```

这里使用 `clear` 而不是 `flush`，避免先渲染尾部增量、随后又立即被最终正文覆盖，也避免已经排队的刷新任务在终态覆盖后重复追加。

如果未来某类流的 `message_end` 不提供完整正文，则该协议必须显式标记，前端改为先 `flush` 再更新终态，不能根据空字符串猜测。

### 7.3 用户停止

用户停止时应保留已经收到但尚未渲染的 Token：

```text
AbortController.abort()
tokenBuffer.flush()
updateAssistantGeneration(messageId, stopped)
```

停止操作不得执行 `clear`，否则会丢失最多一个批次的可见内容。

### 7.4 错误

普通网络或模型错误发生时：

```text
tokenBuffer.flush()
updateAssistantGeneration(messageId, error)
```

这样可以保留错误发生前已经成功接收的部分回答。

SSE `error` 事件当前会转换成异常进入统一 `catch`，缓冲处理应集中放在 `catch`，避免重复刷新。

### 7.5 页面卸载或切换 Agent

页面卸载、切换 Agent 或清空当前会话时：

```text
AbortController.abort()
tokenBuffer.clear()
```

这类场景不会继续展示旧 Assistant 消息，未提交的 Token 应直接丢弃，避免污染新 Agent 或新会话。

## 8. 状态一致性

### 8.1 防止终态后追加

主要竞态：

```text
Token 已进入 buffer
-> message_end 到达
-> 最终正文覆盖
-> 旧 animationFrame 执行
-> 尾部 Token 再次追加
```

`clear` 必须同时完成：

1. 清空内容和 `messageId`。
2. 取消 `requestAnimationFrame`。
3. 取消兜底定时器。

### 8.2 防止旧流污染新流

每个 `handleSend` 已有独立 `AbortController` 和本地 `assistantMessageId`。Token Buffer 额外保存当前批次所属的 `messageId`。切换 Agent、页面卸载和新流启动前清理缓冲。

### 8.3 React 闭包

`onFlush` 应通过 `ref` 保存最新回调，避免 Hook 因调用方重新渲染而重建计时任务，也避免刷新时调用旧闭包。

消息正文更新继续使用函数式 `setMessages`，不能基于渲染闭包中的旧 `messages` 拼接内容。

## 9. 文件改动范围

第一阶段最小实现：

```text
frontend/src/features/chat/hooks/useTokenBuffer.ts
frontend/src/features/chat/ChatPage.tsx
frontend/src/features/chat/hooks/useTokenBuffer.test.ts（按现有测试能力落位）
```

`useChatMessageEvents.ts` 保留批次落入消息状态的职责，`appendAssistantToken` 无需理解调度细节。

第二阶段按性能测量决定是否修改：

```text
frontend/src/features/chat/components/ChatMessageItem.tsx
frontend/src/features/chat/components/ChatTranscript.tsx
```

可选优化包括：

- 使用 `React.memo` 隔离历史消息渲染。
- 稳定 `onRetry`、`onFeedback` 等回调引用。
- 生成期间降低昂贵 Markdown 插件的执行频率。

这些优化不与 Token 批处理绑定，避免扩大第一阶段改动范围。

## 10. 测试方案

### 10.1 Hook 单元测试

使用 fake timers 和模拟 `requestAnimationFrame` 覆盖：

1. 连续追加多个 Token，只调用一次 `onFlush`。
2. 刷新内容保持原始顺序。
3. 动画帧触发后取消兜底定时器，不重复刷新。
4. 动画帧未执行时，50ms 兜底可以刷新。
5. 达到最大缓冲字符数时立即刷新。
6. `flush` 同步提交尾部内容。
7. `clear` 不提交内容并取消所有调度。
8. 切换 `messageId` 时先刷新旧消息，再缓存新消息。
9. Hook 卸载后不再调用 `onFlush`。

### 10.2 Chat 集成场景

1. 高频 Token 到达时正文顺序正确且没有缺字。
2. `message_end` 最终正文不会被旧批次再次追加。
3. 用户停止后保留最后一个未刷新批次。
4. 模型错误后保留已经收到的部分回答。
5. 切换 Agent 后旧 Token 不进入新会话。
6. Workflow 最终正文与中间 Token 不一致时，以 `message_end.content` 为准。
7. 首 Token 耗时不包含 50ms UI 批处理等待。

### 10.3 性能验证

使用浏览器 Performance 和 React Profiler，对同一段固定模拟输出比较改造前后：

```text
输出长度：5000～10000 字符
Token 事件数：1000 次以上
历史消息：50 条
内容：包含标题、列表、代码块和表格的 Markdown
```

记录：

- `setMessages` 调用次数。
- `ChatMessageItem` 渲染次数。
- 主线程长任务数量。
- 完成总耗时。
- 流式过程中页面滚动是否平滑。

## 11. 验收标准

功能验收：

- 连续 Token 无丢失、无乱序、无重复。
- 完成、停止、失败时正文与状态正确。
- 切换 Agent 和卸载页面后无跨会话内容污染。
- Workflow 使用服务端最终正文覆盖中间输出。

性能验收：

- 正常前台页面中，同一动画帧最多执行一次 Token 导致的 `setMessages`。
- 1000 个同步或高频 Token 事件不再对应 1000 次消息状态更新。
- 后台标签页中，未结束流的可见内容最大约 50ms 合并一次；浏览器自身冻结页面的情况除外。
- 用户停止和错误路径最多只保留一个批次的调度延迟，最终状态更新前会同步刷新。

工程验收：

```bash
npm run typecheck
npm run lint
npm run build
```

## 12. 实施顺序

1. 新增 `useTokenBuffer` 及单元测试。
2. 将 `token` 事件从直接更新改为写入 Buffer。
3. 接入 `message_end` 的 `clear + replace`。
4. 接入停止、错误的 `flush`。
5. 接入页面卸载和切换 Agent的 `clear`。
6. 运行类型检查、Lint、构建和 Chat 手工验证。
7. 使用 React Profiler 记录改造前后数据。
8. 只有性能数据仍显示历史消息重渲染明显时，再进入组件 memo 优化。

## 13. 风险与回滚

| 风险                        | 处理方式                       |
| --------------------------- | ------------------------------ |
| 终态覆盖后旧批次再次追加    | `clear` 同时取消动画帧和定时器 |
| 停止时丢失尾部内容          | 停止和错误使用同步 `flush`     |
| 后台标签页不执行动画帧      | 增加 50ms 定时兜底             |
| 上一条消息 Token 写入下一条 | 缓冲保存并校验 `messageId`     |
| 首 Token 指标被批处理放大   | 在 SSE 收到首 Token 时立即记录 |
| 批次太大导致一次渲染卡顿    | 设置 4096 字符上限并立即刷新   |

本方案只改变前端 Token 到 React 状态之间的调度方式。出现问题时，可以将 `token` 事件恢复为直接调用 `appendAssistantToken`，不需要回滚接口、数据库或后端逻辑。
