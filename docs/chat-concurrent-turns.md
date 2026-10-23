# Mia 同一会话并发生成技术方案

## 目标

允许同一用户在多个标签页、手机和电脑上同时向同一个持久会话发送消息，同时保证消息不重复、问答关系不串位、刷新后顺序稳定，并且浏览器断开不会取消后台生成。

## 一致性模型

每次用户发送创建一个 `ChatTurn`。服务端在短事务中为会话分配单调递增的 `sequence`，用户消息和 Assistant 占位消息都绑定同一个 `turnId`。模型可以并发执行，但展示顺序只由 `sequence` 决定，与模型完成先后无关。

```text
ChatSession
  ├─ Turn 101
  │    ├─ USER(position=0)
  │    └─ ASSISTANT(position=1)
  └─ Turn 102
       ├─ USER(position=0)
       └─ ASSISTANT(position=1)
```

客户端为每次发送生成 `clientMessageId`。数据库对 `(session_id, client_message_id)` 建唯一约束，网络重试返回已有 Turn，不重复调用模型。

## 上下文规则

一个 Turn 只读取其创建时间之前已经完成的轮次：

```text
sequence < current.sequence
AND status = COMPLETED
AND completed_at <= current.created_at
```

当前 Turn 的用户输入由 Runtime 单独传入。其他仍在 `QUEUED` 或 `GENERATING` 的轮次不进入上下文，避免连续 user 消息和半截回复污染模型输入。

## 生命周期

```text
QUEUED -> GENERATING -> COMPLETED
                    ├-> FAILED
                    └-> CANCELED
```

创建 Turn 时即持久化用户消息和空的 Assistant 占位消息。成功时更新占位消息；失败或取消时保留占位消息和终态，刷新后不会出现无法解释的孤立问题。

页面刷新、关闭标签页和普通网络断开只断开 SSE，不取消后台任务。只有用户明确点击某一条回复的“停止生成”时，才按该 Turn/Run 取消。

## 接口与事件

现有 `POST /api/v1/chat/streams` 保持兼容，并增加 `clientMessageId`。持久会话的 `message_start`、`message_end` 和 `error` 事件携带：

```json
{
  "turnId": "uuid",
  "runId": "uuid",
  "sequence": "101",
  "messageId": "assistant-message-uuid"
}
```

后续可增加会话级事件流，将 `turn_created`、`turn_completed`、`turn_failed`、`turn_canceled` 推送到其他设备。第一阶段以页面聚焦刷新和短轮询实现最终一致。

## 并发与资源保护

序号分配通过 PostgreSQL 对 `chat_sessions` 单行的原子 `UPDATE ... RETURNING` 完成，只串行化毫秒级的序号分配，不串行化 LLM 请求。全局和 Provider 并发继续由模型网关限制；需要会话级上限时，超出的 Turn 进入 `QUEUED`，不返回冲突错误。

## 恢复与多实例

数据库中的 Turn 和消息是权威状态，SSE 只是实时展示通道。单实例可继续使用内存事件缓冲；多实例部署时将事件分发迁移到 Redis Streams，并用后台任务队列执行生成。服务重启时扫描遗留 `GENERATING` Turn，按可恢复能力重新入队或标记失败。

## 迁移步骤

1. 新增 `chat_turns`、会话序号计数器和消息 Turn 排序字段。
2. 新请求创建 Turn 与 Assistant 占位消息，完成时更新占位消息。
3. 历史读取按 `turn.sequence + position` 排序，旧数据继续按原时间兼容展示。
4. 前端按 `turnId` 管理多个生成状态，卸载时不再主动取消。
5. 增加会话级同步和后台任务恢复，再扩展到多实例。

## 验收标准

- 两端同时发送会获得不同且连续的序号。
- 相同 `clientMessageId` 并发提交只产生一个 Turn。
- 后发送的 Turn 先完成时，刷新后的问答顺序仍不变化。
- 并发 Turn 不读取彼此尚未完成的内容。
- 页面刷新后后台继续生成，重新进入可看到占位状态或最终答案。
- 停止一个 Turn 不影响同会话其他生成。
- 旧 Run 的迟到事件不能覆盖新一次重试。
