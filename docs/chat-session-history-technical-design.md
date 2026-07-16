# Chat 历史分页与多会话技术方案

## 1. 背景与目标

当前保留型 Agent 使用如下约束：

```text
一个成员 + 一个 Agent = 一条会话
```

该设计能解决刷新或关闭窗口后历史丢失的问题，但当记录不断累积时存在三个限制：

- 页面一次性加载全部消息，首屏和滚动性能会下降。
- 用户不能开始一段新的独立讨论。
- 历史消息不应全部塞入模型上下文，否则会导致 Token 超限和成本上升。

本方案将保留型对话升级为“一个成员在一个 Agent 下可拥有多条会话”，并支持历史消息分页加载。

目标：

1. 支持新建、切换、重命名、归档会话。
2. 首次只读取最近一页消息，上滑继续加载更早记录。
3. 模型上下文始终受控，只使用摘要和最近若干轮原文。
4. 保证成员之间的会话数据隔离。
5. 保持单次窗口讨论 `EPHEMERAL` 模式完全不落库。

非目标：

- 本期不做跨成员共享会话、协作编辑或会话导出。
- 本期不将图片和文件二进制写入消息表；附件持久化需依赖统一 Storage 模块。
- 本期不引入 Elasticsearch、Redis 或独立消息服务。

## 2. 设计决策

### 2.1 会话模式

| Agent 配置 | 行为 |
| --- | --- |
| `EPHEMERAL` | 前端内存会话；关闭、刷新、切换 Agent 后丢弃；不创建任何 `chat_sessions` 记录。 |
| `PERSISTENT` | 用户可创建多条已保存会话；每条会话独立保存消息、摘要和生命周期状态。 |

### 2.2 消息分页采用 Cursor，而非 Offset

消息表会持续增长。`OFFSET` 在页码较深时数据库仍需跳过此前所有行，且新消息插入时容易产生重复或漏项。

推荐使用按 `(created_at, id)` 排序的游标：

```text
首次：取最新 50 条
上滑：携带最早一条消息的 (created_at, id) 作为 before cursor
数据库：查询比 cursor 更早的 50 条
前端：把结果 prepend 到当前消息列表
```

`id` 用于解决同一毫秒创建多条消息时的排序稳定性。

### 2.3 模型上下文与页面历史分离

页面可以按需查看全量历史，但每次 LLM 调用不能读取全量消息：

```text
会话摘要（可选）
  + 最近 historyTurns 轮 user/assistant 原文
  + 当前用户消息
  + 当前 RAG 上下文 / 工具定义
```

`historyTurns` 仍由 Agent 配置控制。它是模型上下文窗口，不是前端列表保留数量，也不是数据库清理阈值。

## 3. 数据模型演进

### 3.1 当前模型

当前 `chat_sessions` 有唯一索引：

```prisma
@@unique([agentId, userId], map: "uq_chat_sessions_agent_user")
```

它只允许每个成员在一个 Agent 下有一条会话，需要迁移为普通索引。

### 3.2 目标 Prisma 模型

```prisma
enum ChatSessionStatus {
  ACTIVE
  ARCHIVED

  @@map("chat_session_status")
}

model ChatSession {
  id             String            @id @default(uuid()) @db.Uuid
  agentId        String            @map("agent_id") @db.Uuid
  userId         String            @map("user_id") @db.Uuid
  title          String            @default("")
  status         ChatSessionStatus @default(ACTIVE)
  summary        String?           @db.Text
  summaryUntilId String?           @map("summary_until_id") @db.Uuid
  lastMessageAt  DateTime?         @map("last_message_at") @db.Timestamptz(6)
  archivedAt     DateTime?         @map("archived_at") @db.Timestamptz(6)
  createdAt      DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)
  agent          Agent             @relation(fields: [agentId], references: [id], onDelete: Cascade)
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages       ChatSessionMessage[]

  @@index([agentId, userId, status, lastMessageAt(sort: Desc)], map: "idx_chat_sessions_agent_user_status_last_message")
  @@index([userId, status, updatedAt(sort: Desc)], map: "idx_chat_sessions_user_status_updated_at")
  @@map("chat_sessions")
}

model ChatSessionMessage {
  id        String                 @id @default(uuid()) @db.Uuid
  sessionId String                 @map("session_id") @db.Uuid
  role      ChatSessionMessageRole
  content   String                 @db.Text
  metadata  Json?                  @db.JsonB
  createdAt DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  session   ChatSession            @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt(sort: Desc), id(sort: Desc)], map: "idx_chat_session_messages_cursor")
  @@map("chat_session_messages")
}
```

字段说明：

- `title`：新会话初始使用“新对话”，首条用户消息成功保存后截取其前 40 个字符作为默认标题；允许用户手动修改。
- `status`：归档不删除记录；默认列表只读取 `ACTIVE`。
- `summary` / `summaryUntilId`：保存早期历史摘要，以及摘要已覆盖到哪条消息，避免重复摘要。
- `lastMessageAt`：会话列表按实际消息时间排序，不依赖标题或页面读取造成的 `updatedAt` 变化。
- `metadata`：预留检索来源、工具调用状态、附件引用等结构化展示信息；不得存储大体积 base64 / data URL。

### 3.3 迁移 SQL 要点

```sql
-- 先移除“一成员一 Agent 一会话”的旧约束。
DROP INDEX "uq_chat_sessions_agent_user";

CREATE TYPE "chat_session_status" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "chat_sessions"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" "chat_session_status" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "summary_until_id" UUID,
  ADD COLUMN "last_message_at" TIMESTAMPTZ(6),
  ADD COLUMN "archived_at" TIMESTAMPTZ(6);

ALTER TABLE "chat_session_messages"
  ADD COLUMN "metadata" JSONB;

-- 旧数据仍只有一条会话，但迁移后可创建更多会话。
UPDATE "chat_sessions"
SET "last_message_at" = latest.created_at
FROM (
  SELECT "session_id", MAX("created_at") AS "created_at"
  FROM "chat_session_messages"
  GROUP BY "session_id"
) latest
WHERE latest.session_id = "chat_sessions".id;

CREATE INDEX "idx_chat_sessions_agent_user_status_last_message"
  ON "chat_sessions" ("agent_id", "user_id", "status", "last_message_at" DESC);
CREATE INDEX "idx_chat_session_messages_cursor"
  ON "chat_session_messages" ("session_id", "created_at" DESC, "id" DESC);
```

迁移必须在低峰期执行，并在迁移前备份 PostgreSQL。当前聊天量较小时，`last_message_at` 回填可在同一个迁移内完成；数据量增长后应改为后台分批任务。

## 4. API 设计

所有接口位于 `/api/v1/chat`，均要求登录。Controller 只获取 `CurrentUser` 并调用 `ChatService`；会话归属校验集中在 Service 内部。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/sessions?agentId=...&status=ACTIVE&cursor=...&pageSize=20` | 获取当前用户在 Agent 下的会话列表。 |
| `POST` | `/sessions` | 新建空会话，返回会话详情。 |
| `GET` | `/sessions/:sessionId/messages?before=...&pageSize=50` | 获取一页历史消息。 |
| `PATCH` | `/sessions/:sessionId` | 修改标题。 |
| `POST` | `/sessions/:sessionId/archive` | 归档会话。 |
| `POST` | `/sessions/:sessionId/restore` | 恢复已归档会话。 |
| `DELETE` | `/sessions/:sessionId` | 软删除或彻底删除，v1 推荐先做软删除。 |
| `POST` | `/stream` | 现有 SSE 接口；`sessionId` 改为保留型 Agent 的必填字段。 |

### 4.1 DTO 摘要

```ts
type CreateChatSessionDto = {
  agentId: string;
};

type ChatSessionListItem = {
  id: string;
  agentId: string;
  title: string;
  status: "ACTIVE" | "ARCHIVED";
  lastMessageAt: Date | null;
  createdAt: Date;
};

type ChatMessageCursor = {
  createdAt: string;
  id: string;
};

type ChatMessagePage = {
  list: ChatSessionMessageDto[]; // 按时间正序返回，方便前端 prepend
  nextBefore: ChatMessageCursor | null;
  hasMore: boolean;
};
```

Cursor 推荐编码为 URL-safe Base64 JSON：

```json
{"createdAt":"2026-07-21T10:30:00.000Z","id":"uuid"}
```

服务端必须严格解析、校验字段类型和时间格式；解析失败返回 `400`，不能将 cursor 当作 SQL 字符串拼接。

## 5. Service 编排

建议在 `backend/src/modules/chat/` 内新增会话服务，避免把聊天历史查询散落在 `ChatService` 的 SSE 主流程中：

```text
chat/
  chat.controller.ts
  chat.service.ts              # SSE、LLM、RAG、工具编排
  chat-sessions.service.ts     # 会话 CRUD、归属校验、分页、摘要状态
  dto/
    chat.dto.ts
    chat-session.dto.ts
```

职责：

- `ChatSessionsService`：创建/列出/归档会话、验证 `sessionId + agentId + userId`、读取消息分页、写入消息、构建 LLM 历史上下文。
- `ChatService`：在流式开始前获取已验证会话；写入用户消息；流结束后写入完整助手消息；不直接拼 Prisma 的会话查询。

流式主路径：

```text
POST /chat/stream (agentId, sessionId, message)
  -> AgentsService.getAgentRuntimeConfig(agentId)
  -> ChatSessionsService.requireActiveSession(sessionId, agentId, userId)
  -> ChatSessionsService.buildModelHistory(sessionId, historyTurns)
  -> ChatSessionsService.appendUserMessage(...)
  -> RetrievalService / ToolsService / ModelProvidersService
  -> SSE token
  -> 流式完整结束：ChatSessionsService.appendAssistantMessage(...)
  -> message_end
```

取消与失败规则：

- 用户消息在模型调用前写入，因此失败后问题仍可追溯。
- 助手消息只有收到完整 `message_end` 后写入，避免把中断回答伪装成完整答案。
- 可选扩展：为消息加 `status = COMPLETED | CANCELED | FAILED`，用于保留部分生成内容；v1 先不保存半截答案。
- `appendMessage` 事务内同时更新 `last_message_at`，确保会话列表排序正确。

## 6. 分页查询实现

查询“比 cursor 更早”的消息：

```ts
const where: Prisma.ChatSessionMessageWhereInput = {
  sessionId,
  ...(before
    ? {
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } }
        ]
      }
    : {})
};

const rows = await prisma.chatSessionMessage.findMany({
  where,
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: pageSize + 1
});

const hasMore = rows.length > pageSize;
const page = rows.slice(0, pageSize).reverse();
```

注意：上述比较依赖 UUID 的可排序性仅作为同一时间戳的稳定 tie-breaker，不用于按生成时间推断业务语义。若数据库未来改用不同 ID 类型，仍应保留单调 sequence 或单独的 `created_at + id` 组合游标约束。

## 7. 前端交互与状态

目录建议：

```text
frontend/src/features/chat/
  components/
    ChatSessionList.tsx
    ChatSessionListItem.tsx
    ChatTranscript.tsx
  hooks/
    useChatSessions.ts
    useChatMessageHistory.ts
    useChatStream.ts
```

交互规则：

1. 选择保留型 Agent 后，加载该 Agent 最近活动会话列表；默认打开最近一条。
2. 点击“新建对话”先调用 `POST /sessions`，再清空 transcript 并进入新会话。
3. transcript 首次加载最近 50 条；滚动到顶部且 `hasMore=true` 时加载上一页，并保持当前可视消息位置不跳动。
4. SSE 进行中禁止切换或归档当前会话；如需切换，先确认停止生成。
5. 单次模式不显示会话列表与“新建对话”按钮，维持当前简洁聊天页。

异步保护：

- 会话列表、消息分页和 SSE 使用独立 `AbortController`。
- 切换 Agent / 会话时取消旧请求，并用 request sequence 防止旧响应覆盖当前页面。
- StrictMode 下 GET 请求继续使用现有 HTTP 层并发合并，组件 cleanup 只阻止过期 state 更新。

## 8. 摘要策略

摘要不应在每次请求都触发。推荐阈值：

```text
未摘要的历史消息超过 24 条或估算超过 8,000 tokens
-> 后台生成摘要
-> 保存 summary 与 summary_until_id
```

生成摘要时：

1. 读取 `summary_until_id` 之后、最近上下文窗口之前的历史消息。
2. 将旧摘要与新增消息交给低成本 Chat 模型，生成事实性摘要。
3. 在事务内更新 `summary` 和 `summary_until_id`。
4. 构建模型上下文时只使用摘要加未覆盖的最近消息。

摘要失败不阻塞正常聊天，下一次后台任务可重试。摘要内容不得包含 API Key、Cookie、内部路径等敏感配置；必要时先执行脱敏。

## 9. 权限、安全与可观测性

- 所有会话读写查询必须带 `userId` 和 `agentId`；不能仅按 `sessionId` 查询。
- 普通成员只可使用启用 Agent，并只能操作自己的会话。
- Admin 不应默认看到成员会话正文；如未来需要审计，应新增独立的审计权限和访问日志。
- 在 `tool_call_logs`、对话日志中记录 `session_id`，便于排查一次连续对话。
- 会话标题、消息内容和摘要不得输出到普通 HTTP 访问日志。
- 需要为单个用户设置会话/消息数量上限，避免误用导致数据库无限增长。

建议初始保留策略：

```text
活跃会话：长期保留
已归档会话：180 天后可由管理员任务清理
单会话消息软上限：20,000 条
单用户所有消息软上限：200,000 条
```

达到软上限时先提示归档和清理，不自动删除活跃会话。

## 10. 实施步骤与验收

### 第一步：数据模型与会话 CRUD

- 迁移移除旧唯一约束，新增会话状态、标题、时间字段和消息 metadata。
- 实现 `ChatSessionsService` 和列表/新建/归档接口。
- 验收：同一用户可为同一 Agent 创建两条会话；另一个用户不能读取它们。

### 第二步：消息分页与聊天页接入

- 实现 cursor 编解码、消息分页接口和前端上滑加载。
- 改造 SSE 入参：保留型 Agent 必须传 `sessionId`。
- 验收：首屏只返回 50 条；连续加载不会重复、漏消息或改变当前滚动位置。

### 第三步：上下文摘要与清理任务

- 增加摘要后台任务、阈值配置、会话归档清理任务。
- 验收：长会话不会超过上下文窗口；摘要失败不影响继续聊天；清理任务可 dry-run。

### 最小测试集

- `ChatSessionsService`：归属校验、创建、归档、cursor 边界与排序稳定性。
- `ChatService`：持久模式必须传有效 `sessionId`；单次模式不写消息表；流完成后写入助手消息。
- 前端：切换会话取消旧请求；上滑加载保持滚动位置；停止生成不写完整助手消息。
- 迁移：已有单会话数据迁移后仍可读取，且可创建第二条会话。

## 11. 回滚方案

本方案增加字段与索引、移除唯一约束，应用层回滚相对安全：旧版本仍可读取旧会话数据，但它会继续按旧逻辑选择一条会话。

数据库回滚不要在生产环境直接重新创建唯一索引，因为已有多会话数据会冲突。正确处理方式：

1. 先回滚应用代码，停止新会话创建。
2. 保留新字段和多会话数据。
3. 修复后再发布新版本。
4. 只有确认每个 `(agent_id, user_id)` 仅剩一条会话时，才允许恢复旧唯一约束。

因此本次数据迁移属于向前兼容迁移，生产环境必须先备份后执行。
