# Mia Dify 风格外部访问技术方案

## 1. 背景与决策

Mia 目前可通过 `shareToken` 发布 Agent，并由 `mia-agent-widget.js` 在外部页面加载。该方式适合公开访问，但缺少稳定的外部用户归属、外部系统服务端调用边界，以及后续会话历史和调用审计的统一模型。

本方案参考 Dify 的两条访问路径：

1. **WebApp / Widget**：长期公开 Agent Token，浏览器直接访问，适合匿名或公开客服。
2. **Service API**：业务后端持有长期 App API Key，每次请求显式传入稳定的 `user` 标识，适合小程序、业务系统和服务端集成。

Dify 的 `user` 是数据隔离键，不是身份认证字段；API Key 必须只保存于业务后端，不能嵌入浏览器或小程序。参考：[Dify API 入门](https://docs.dify.ai/en/api-reference/guides/get-started)、[Dify End User Identity](https://docs.dify.ai/en/api-reference/guides/end-user-identity)。

### 1.1 本次决策

- Widget 标准参数只保留 `agentToken`，**不增加 `visitorToken`**。
- `agentToken` 对应公开 Agent，允许出现在嵌入代码中，不等同于工作台登录凭证或服务端 API Key。
- 新增 Agent API Key，供业务后端调用；Key 只显示一次，数据库只保存哈希。
- 新增 End User 概念，统一保存 Widget 匿名访客和 Service API 业务用户。
- Widget 与 Service API 的 End User 和会话默认隔离，防止公开访客历史与业务用户历史混用。

### 1.2 不在本期实现

- 外部用户登录、SSO 或 `visitorToken` 认证。
- 多租户 Workspace。
- 向业务客户端下发 Mia Agent API Key。
- 将业务系统的用户资料镜像同步至 Mia。
- 跨 Agent 共享会话或跨 Agent 读取历史。

## 2. 概念与权限边界

| 概念                | 用途                                     | 是否可以出现在客户端 | 是否用于认证                         |
| ------------------- | ---------------------------------------- | -------------------- | ------------------------------------ |
| 工作台 Access Token | Mia 管理员/成员访问工作台                | 否，内存短期 Token   | 是                                   |
| `agentToken`        | 已发布 Agent 的公开 WebApp / Widget 标识 | 是                   | 仅识别公开 Agent，不代表业务用户身份 |
| Agent API Key       | 业务后端调用指定 Agent 的凭证            | 否                   | 是                                   |
| `user`              | Service API 的外部业务用户隔离键         | 仅由业务后端传递     | 否                                   |
| Widget `session_id` | 匿名浏览器访客隔离键                     | 是                   | 否                                   |

安全边界如下：

```text
公开 Widget
浏览器 -- agentToken + widget session_id --> Mia Public API

业务系统 API
小程序/网页 --> 业务后端 -- Agent API Key + user --> Mia Service API

Mia 工作台
管理员/成员 -- 工作台 Access Token --> Mia Internal API
```

不能把 Agent API Key 放入 Widget、Web 前端、小程序包或可被客户端读取的配置。`user` 由业务后端提供，但 Mia 不验证该字符串归属；业务系统必须自行完成登录态验证，防止用户伪造其他人的 ID。

## 3. 发布模型

### 3.1 公开 WebApp / Widget

现有 `Agent.shareToken` 演进为公开 `agentToken`，继续保持对外可见和可复制：

```html
<script
  src="https://mia.example.com/mia-agent-widget.min.js"
  data-agent-token="公开 Agent Token"
  data-api-base="https://mia.example.com"
  async
></script>
```

Widget 首次初始化时生成 UUID，并以 Agent Token 为命名空间写入本地存储：

```text
mia_widget_session:{agentToken} = uuid
```

每次公开聊天请求携带：

```json
{
  "agentToken": "公开 Agent Token",
  "sessionId": "匿名浏览器 UUID",
  "message": "你好",
  "conversationId": "可选，服务端返回"
}
```

同一浏览器、同一 Agent 使用同一个 `sessionId`；清除浏览器存储或切换设备后视为新的匿名 End User。Widget 不传姓名、手机号、业务用户 ID 等可识别资料。

### 3.2 Service API

Service API 采用 Dify 风格：一个 Agent API Key 对应一个已发布 Agent，业务后端通过 Key 选择 Agent，不在 body 中传 Agent ID。

```http
POST /api/v1/service/chat-messages
Authorization: Bearer mia_agent_xxx
Content-Type: application/json

{
  "query": "识别图片中的衣物",
  "response_mode": "streaming",
  "user": "ootd:wx-openid-123",
  "conversation_id": "可选，由 Mia 首次响应返回",
  "inputs": {},
  "files": []
}
```

调用方规则：

- `user` 在同一 Agent 内必须稳定，建议使用带业务前缀的不可变 ID，例如 `ootd:user:{id}`。
- 创建会话、继续会话、上传文件、停止生成必须使用相同 `user`。
- `conversation_id` 必须属于当前 Agent 和当前 End User，否则返回业务错误。
- API Key 泄漏时管理员可立即撤销或轮换；撤销不影响其他 Key。

衣间录小程序应遵循：

```text
微信小程序
  -> 衣间录后端（校验微信登录态、读取业务用户 ID）
  -> Mia Service API（Agent API Key + user）
  -> 模型流式结果
  -> 衣间录后端 / 小程序
```

## 4. 数据模型

### 4.1 Agent API Key

```prisma
model AgentApiKey {
  id          String    @id @default(uuid()) @db.Uuid
  agentId     String    @map("agent_id") @db.Uuid
  name        String
  keyPrefix   String    @map("key_prefix")
  keyHash     String    @unique(map: "uq_agent_api_keys_key_hash") @map("key_hash")
  lastUsedAt  DateTime? @map("last_used_at") @db.Timestamptz(6)
  expiresAt   DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdById String    @map("created_by_id") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  agent       Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId, createdAt(sort: Desc)], map: "idx_agent_api_keys_agent_id_created_at")
  @@index([expiresAt], map: "idx_agent_api_keys_expires_at")
  @@map("agent_api_keys")
}
```

原始 Key 格式：

```text
mia_agent_<prefix>_<random>
```

- 使用 `crypto.randomBytes(32)` 生成随机部分。
- `keyPrefix` 用于管理页定位，例如展示 `mia_agent_ab12...`。
- `keyHash = SHA-256(rawKey)`，只存哈希。
- 创建成功响应只返回一次 `rawKey`，后续列表和详情永不返回。

### 4.2 External End User

```prisma
enum ExternalUserSource {
  WIDGET
  WEBAPP
  SERVICE_API
}

model ExternalEndUser {
  id           String             @id @default(uuid()) @db.Uuid
  agentId      String             @map("agent_id") @db.Uuid
  source       ExternalUserSource
  externalId   String             @map("external_id")
  firstSeenAt  DateTime           @default(now()) @map("first_seen_at") @db.Timestamptz(6)
  lastSeenAt   DateTime           @default(now()) @map("last_seen_at") @db.Timestamptz(6)
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  agent        Agent              @relation(fields: [agentId], references: [id], onDelete: Cascade)
  conversations ExternalConversation[]

  @@unique([agentId, source, externalId], map: "uq_external_end_users_agent_source_external")
  @@index([agentId, lastSeenAt(sort: Desc)], map: "idx_external_end_users_agent_last_seen_at")
  @@map("external_end_users")
}
```

`externalId` 的来源：

| source        | external_id                                        |
| ------------- | -------------------------------------------------- |
| `WIDGET`      | Widget 本地生成的 `session_id`                     |
| `WEBAPP`      | Public WebApp Cookie / Local Storage 生成的匿名 ID |
| `SERVICE_API` | 请求 body 中的 `user`                              |

### 4.3 External Conversation

当前 Mia Widget 消息只保存在页面内存，尚不存在持久化的 chat session/message 表。本方案增加外部会话模型时，应同时设计会话和消息持久化，不仅新增 `conversation_id` 字段：

```prisma
model ExternalConversation {
  id                String          @id @default(uuid()) @db.Uuid
  agentId           String          @map("agent_id") @db.Uuid
  externalEndUserId String          @map("external_end_user_id") @db.Uuid
  title             String?
  source            ExternalUserSource
  createdAt         DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt         DateTime?       @map("deleted_at") @db.Timestamptz(6)
  agent             Agent           @relation(fields: [agentId], references: [id], onDelete: Cascade)
  externalEndUser   ExternalEndUser @relation(fields: [externalEndUserId], references: [id], onDelete: Cascade)
  messages          ExternalMessage[]

  @@index([externalEndUserId, updatedAt(sort: Desc)], map: "idx_external_conversations_end_user_updated_at")
  @@index([agentId, createdAt(sort: Desc)], map: "idx_external_conversations_agent_created_at")
  @@map("external_conversations")
}

model ExternalMessage {
  id             String               @id @default(uuid()) @db.Uuid
  conversationId String               @map("conversation_id") @db.Uuid
  role           String
  content        String               @db.Text
  createdAt      DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  conversation   ExternalConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt], map: "idx_external_messages_conversation_created_at")
  @@map("external_messages")
}
```

消息表的附件、工具调用、检索来源、用量等复杂字段不在首个 migration 一次性加入；先以 JSONB 事件或现有日志关联承接，确认业务需要后再拆列。

## 5. 后端模块边界

新增 `external_access` 模块，避免把公开访问、服务端 API Key 和工作台认证混入 `auth`：

```text
backend/src/modules/external_access/
  external-access.module.ts
  public-agents.controller.ts
  service-api.controller.ts
  external-access.service.ts
  agent-api-keys.service.ts
  end-users.service.ts
  dto/
    agent-api-key.dto.ts
    public-chat.dto.ts
    service-chat.dto.ts
  guards/
    agent-api-key.guard.ts
```

职责：

| 模块              | 职责                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `agents`          | 发布状态、公开 Agent Token、管理端 Agent API Key 配置入口                |
| `external_access` | 解析 Token/Key、解析 External End User、会话归属校验、访问限流           |
| `chat`            | 复用既有 Agent/RAG/模型/工具 SSE 编排，不处理外部身份认证                |
| `logs`            | 记录 source、agentApiKeyId、externalEndUserId、conversationId、requestId |

调用方向：

```text
external_access -> agents, chat, logs
chat            -> agents, retrieval, model_providers, tools, logs
```

`chat` 不直接读取 `AgentApiKey`，以免对话编排层知道不同发布渠道的鉴权细节。

## 6. API 设计

### 6.1 管理端 Agent API Key

所有接口需要 Mia 工作台登录且具有 Agent 管理权限：

```text
POST   /api/v1/agents/:agentId/api-keys
GET    /api/v1/agents/:agentId/api-keys
DELETE /api/v1/agents/:agentId/api-keys/:keyId
POST   /api/v1/agents/:agentId/api-keys/:keyId/rotate
```

创建响应：

```json
{
  "id": "uuid",
  "name": "衣间录生产环境",
  "keyPrefix": "mia_agent_ab12",
  "apiKey": "mia_agent_ab12_...",
  "createdAt": "2026-07-21T00:00:00.000Z"
}
```

列表响应不包含 `apiKey`。

### 6.2 Public Widget API

```text
GET  /api/v1/public/agents/:agentToken
POST /api/v1/public/chat-messages
POST /api/v1/public/chat-messages/:taskId/stop
```

Public Chat 解析 `agentToken + sessionId` 为 `ExternalEndUser(source=WIDGET)`。公开请求必须限制可访问 Agent 状态、来源域名、消息频率、文件类型与大小。

### 6.3 Service API

```text
POST /api/v1/chat-messages
GET  /api/v1/conversations
GET  /api/v1/messages
POST /api/v1/chat-messages/:taskId/stop
POST /api/v1/files/upload
```

所有 Service API 使用：

```http
Authorization: Bearer mia_agent_xxx
```

`AgentApiKeyGuard` 的固定步骤：

```text
读取 Bearer Key
-> 校验格式
-> SHA-256 后查询未撤销、未过期 Key
-> 加载已发布且启用的 Agent
-> 写入 request context: agentId / agentApiKeyId
-> 更新 last_used_at（异步失败不阻断主请求）
```

Service API 的 `user` 校验规则：

- 必填，长度 1-256。
- 允许字母、数字、`_`、`-`、`.`、`:`、`@`；拒绝空白和控制字符。
- 不返回不同用户是否存在的信息。
- 同一个 `conversation_id` 与 `user` 不匹配时统一返回“会话不存在或无权访问”。

## 7. 请求编排

### 7.1 Widget 请求

```text
Widget 初始化
-> 读取或生成 session_id
-> GET Public Agent Profile
-> POST Public Chat
-> external_access 解析 agentToken + sessionId
-> 获取/创建 ExternalEndUser(WIDGET)
-> 创建/校验 ExternalConversation
-> chat.service SSE 编排
-> 持久化外部消息与日志
```

### 7.2 Service API 请求

```text
衣间录后端
-> POST /chat-messages + Agent API Key + user
-> AgentApiKeyGuard 解析唯一 Agent
-> external_access 获取/创建 ExternalEndUser(SERVICE_API)
-> 创建/校验 ExternalConversation
-> chat.service SSE 编排
-> 返回 Dify 风格 SSE / JSON
-> 写入外部会话、消息、日志
```

## 8. 安全、限流与审计

### 8.1 Key 与 Token

- `agentToken` 可公开但必须支持撤销和轮换；轮换后旧 Widget 配置需要更新。
- Agent API Key 必须只显示一次，保存哈希，支持命名、过期、撤销、轮换与最后使用时间。
- 不复用 `MIA_AUTH_JWT_SECRET`、Refresh Token 或工作台 Access Token 作为 Agent API Key。
- API Key、Authorization Header、原始 `user` 不写入普通错误日志。

### 8.2 限流

| 入口               | 推荐初始限制 | 限流键                      |
| ------------------ | ------------ | --------------------------- |
| Widget Profile     | 60 次/分钟   | agentToken + IP             |
| Widget Chat        | 20 次/分钟   | agentToken + sessionId + IP |
| Service API Chat   | 60 次/分钟   | agentApiKeyId + user        |
| Service API Upload | 20 次/分钟   | agentApiKeyId + user        |

限流命中返回明确业务错误，不消耗模型调用并写入安全日志。

### 8.3 日志字段

所有外部调用增加：

```text
request_id
source = widget | webapp | service_api
agent_id
agent_api_key_id（仅 Service API）
external_end_user_id
conversation_id
external_user_hash（对 user/session_id 做 HMAC 或哈希）
```

管理端日志默认不展示原始业务 `user`；需要排查时由具备权限的管理员按受控方式查询。

## 9. 兼容与迁移

### 9.1 保持兼容

- 现有 Widget `data-agent-token` 参数继续有效。
- 现有 `shareToken` 在 v1 中继续作为 `agentToken`，不强制重新发布 Agent。
- 当前 `POST /api/v1/chat/stream` 继续仅供工作台使用，不修改其内部认证语义。

### 9.2 新增公开接口

不要让 Widget 改调内部 `/api/v1/chat/stream`。新增 Public Chat API，显式区分公开调用与工作台调用，避免为了兼容 Widget 而弱化内部 Chat 的 JWT Guard。

### 9.3 会话迁移

当前 Widget 历史仅在页面内存，无法无损迁移为服务端会话：

1. 发布新 Widget 后，首次对话创建 `ExternalEndUser` 和 `ExternalConversation`。
2. 旧页面内存 history 可以作为首次请求上下文，但不回填历史数据。
3. 新会话由服务端返回 `conversation_id`，Widget 保存并在刷新后继续使用。

## 10. 开发版本拆分

### v1：公开 Widget 会话与审计

- 新增 `ExternalEndUser`、`ExternalConversation`、`ExternalMessage`。
- 新增 Public Agent Profile / Public Chat SSE。
- Widget 生成并持久化 `session_id` 与 `conversation_id`。
- 日志记录 source、匿名 End User、会话 ID。
- 公开入口基础限流。

验收：刷新 Widget 后同浏览器同 Agent 可恢复会话；不同浏览器不会读取对方历史。

### v1.1：Agent API Key 与 Service API

- 新增 `AgentApiKey`、创建/列表/撤销/轮换 API。
- 新增 Dify 风格 `/chat-messages`、会话与消息查询、停止生成、文件上传接口。
- Service API 的 `user` 与 conversation 归属校验。
- Agent API Key 限流、使用审计和错误脱敏。

验收：衣间录后端以 API Key 调用指定 Agent；相同 `user` 能续聊，不同 `user` 无法读取彼此会话。

### v1.2：发布治理

- Agent Token 轮换、过期和公开入口开关。
- Widget 域名 allowlist、公开页密码、反滥用策略。
- 管理端外部访问日志与 API Key 使用统计。

### v2：企业接入能力

- 自定义域名。
- 外部用户 SSO / 可信 JWT 映射（仅在真实业务需要时引入）。
- Webhook、配额、应用级统计和 OpenAPI 文档。

## 11. 测试矩阵

| 场景                     | 断言                                                 |
| ------------------------ | ---------------------------------------------------- |
| Widget 首次访问          | 创建 WIDGET End User 与会话，返回 conversation_id    |
| Widget 刷新              | 使用已保存 session_id / conversation_id 读取同一会话 |
| 不同 Widget session      | 无法读取其他 session 的会话                          |
| 无效 agentToken          | 不泄露 Agent 是否存在的内部细节                      |
| 创建 Agent API Key       | 原始 Key 仅创建响应出现一次，数据库只有哈希          |
| 撤销 API Key             | 后续请求立即被拒绝                                   |
| Service API 同一 user    | 可续聊、可查询自身会话                               |
| Service API 跨 user 会话 | 返回会话不存在或无权访问                             |
| API Key 出现在客户端请求 | 文档/安全扫描禁止该接入方式                          |
| 限流命中                 | 不调用 LLM，写入限流日志                             |

## 12. 实施前置条件

1. 明确公开 Agent 是否允许无密码访问，以及默认限流阈值。
2. 确认外部会话与消息的保留时长、删除机制和备份策略。
3. 为衣间录后端准备仅在服务端存放的 Agent API Key 配置。
4. 完成 Public Chat API 后再修改 Widget 调用链；修改 `frontend/public/mia-agent-widget.js` 时必须同步执行 `npm run build:widget`。
5. 每个新增 Prisma migration 先在开发数据库验证，再通过 `prisma migrate deploy` 进入生产环境。
