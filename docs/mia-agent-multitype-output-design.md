# Mia Agent 多类型输出技术方案

> 文档状态：实施设计稿  
> 适用范围：工作台 Chat、持久会话、公开 Widget、Service API、Workflow、Tools  
> 输出类型：`text`、`json`、`image`、`file`

## 1. 背景与目标

Mia 当前对话链路以纯文本为主：模型通过 SSE `token` 输出正文，`ChatSessionMessage.content` 使用 `Text` 持久化，前端通过 `ReactMarkdown` 渲染。工具已经可以返回结构化 JSON，但工具结果、最终回答、文件持久化和终端展示之间尚未形成统一的多类型输出协议。

本方案在不破坏现有文本对话、SSE、历史会话和外部访问接口的前提下，使 Agent 最终消息支持：

- `text`：普通文本或 Markdown。
- `json`：结构化 JSON。
- `image`：可预览、可下载的图片。
- `file`：可下载文件。

一条消息可以按顺序包含多个不同类型的内容块。

### 1.1 建设目标

- 工作台、Widget、Service API 和历史会话使用同一套内容语义。
- 文本保持现有流式体验；JSON、图片和文件以完整内容块交付。
- 文件本体统一交给 Storage Service，Chat 只保存文件引用和业务关系。
- 旧客户端和旧消息继续通过 `content` 字段正常工作。
- 为后续增加 `audio`、`video` 等类型保留稳定扩展点。

### 1.2 非目标

- 本期不引入开放式插件市场。
- 本期不为音频和视频设计专用播放器协议，统一作为 `file` 下载。
- 本期不要求所有模型直接生成图片；图片通常由工具、Workflow 或外部服务产生。
- 本期不部署 MinIO/S3，但 Storage Backend 必须可替换。

## 2. 核心技术决策

1. `parts` 是新的标准内容协议，`content` 是兼容文本。
2. `text` 继续使用现有 `token` 流，不重新设计文本 SSE。
3. JSON、图片、文件通过新增的 `content_part` 事件交付。
4. `message_end.parts` 是最终权威消息快照。
5. `image/file` 必须进入 Storage 后才能成为正式内容块。
6. 数据库和 API 不保存 Base64、Buffer、真实磁盘路径或供应商临时 URL。
7. 工具内部 `output` 与最终用户可见的 `contentParts` 分离。
8. 旧消息在读取时动态转换，不进行高风险全量迁移。

## 3. 总体架构

```text
模型文本输出 ────────────────┐
Workflow End 结构化输出 ─────┤
Tool / MCP / HTTP 输出 ──────┤
                            ▼
                    Agent Runtime
                 归一化 AgentContentPart[]
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
         text / json                 image / file
          消息内容                    Storage Service
              │                           │
              └─────────────┬─────────────┘
                            ▼
                 Chat SSE + 消息持久化
                            │
             工作台 / Widget / Service API
```

### 3.1 模块职责

| 模块 | 职责 | 禁止事项 |
| --- | --- | --- |
| `agent_runtime` | 编排模型、Workflow 和工具输出，归一化内容块 | 不操作真实磁盘，不持久化 Chat 消息 |
| `storage` | 保存、读取、删除文件，维护文件元数据和 Backend | 不理解 Agent、Chat、Knowledge 业务含义 |
| `chat` | 输出 SSE，保存内部会话消息和附件关系 | 不保存 Base64、Buffer 或磁盘路径 |
| `tools` | 执行工具，返回模型结果和可展示内容 | 不直接写 ChatMessage |
| `external_access` | 管理 Widget/Service API 会话、消息和文件授权 | 不让 Chat 反向依赖外部会话表 |
| 前端/Widget | 按内容块类型渲染和降级 | 不信任 MIME、文件名或 HTML |

### 3.2 依赖方向

新增 Storage 后建议允许：

```text
chat -> storage
external_access -> chat, storage
knowledge -> storage
agent_runtime -> model_providers, tools, storage
```

`storage` 只依赖 `core` 和自身数据表，不依赖任何业务模块。

## 4. 内容块协议

建议在 `backend/src/modules/agent_runtime/dto/` 定义供应商无关的运行时协议：

```ts
export type AgentContentPart =
  | AgentTextContentPart
  | AgentJsonContentPart
  | AgentImageContentPart
  | AgentFileContentPart;

export type AgentTextContentPart = {
  type: "text";
  text: string;
};

export type AgentJsonContentPart = {
  type: "json";
  value: JsonValue;
  title?: string;
};

export type AgentImageContentPart = {
  type: "image";
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
};

export type AgentFileContentPart = {
  type: "file";
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
};
```

进入 Storage 之前使用单独的待处理类型：

```ts
export type PendingFileContentPart = {
  type: "image" | "file";
  name: string;
  mimeType?: string;
  source:
    | { type: "buffer"; data: Uint8Array }
    | { type: "stream"; stream: ReadableStream }
    | { type: "url"; url: string }
    | { type: "stored_file"; fileId: string };
};
```

### 4.1 最终消息示例

```json
{
  "id": "message-id",
  "role": "assistant",
  "content": "分析完成，结果如下：",
  "parts": [
    {
      "type": "text",
      "text": "分析完成，结果如下："
    },
    {
      "type": "image",
      "fileId": "file-id-1",
      "name": "chart.png",
      "mimeType": "image/png",
      "size": 182034
    },
    {
      "type": "file",
      "fileId": "file-id-2",
      "name": "report.pdf",
      "mimeType": "application/pdf",
      "size": 820341
    },
    {
      "type": "json",
      "value": {
        "status": "success",
        "score": 92
      }
    }
  ]
}
```

### 4.2 协议约束

- `parts` 数组顺序就是最终展示顺序。
- `content` 保存所有 `text` 内容拼接后的兼容文本。
- `json.value` 必须可 JSON 序列化，并限制序列化后的字节数。
- `image/file` 持久化后只能包含 `fileId` 和安全元数据。
- 文件名只用于展示，不能参与真实磁盘路径计算。
- 未识别内容类型不能导致整条消息渲染失败。

## 5. SSE 协议

保留现有 `token` 和 `message_end`，新增 `content_part`。

### 5.1 文本增量

```json
{
  "type": "token",
  "data": {
    "content": "正在生成"
  }
}
```

### 5.2 完整内容块

JSON、图片和文件不做 token 化：

```json
{
  "type": "content_part",
  "data": {
    "index": 1,
    "part": {
      "type": "json",
      "value": {
        "score": 92
      }
    }
  }
}
```

### 5.3 最终事件

```json
{
  "type": "message_end",
  "data": {
    "content": "分析完成，结果如下：",
    "parts": [
      {
        "type": "text",
        "text": "分析完成，结果如下："
      },
      {
        "type": "json",
        "value": {
          "score": 92
        }
      }
    ],
    "persistedMessageId": "message-id"
  }
}
```

### 5.4 处理规则

- `message_end.parts` 是最终权威结果。
- 前端可以通过 `content_part` 提前展示，最终必须使用 `message_end.parts` 覆盖临时状态。
- 旧客户端忽略 `content_part`，继续读取 `token` 和 `message_end.content`。
- 图片和文件必须成功进入 Storage 后才能发送 `content_part`。
- 生成失败时不得产生指向不存在文件的正式内容块。

## 6. 第一阶段：完成 text + json

### 6.1 输出来源

| 类型 | 允许来源 | 交付方式 |
| --- | --- | --- |
| `text` | LLM token、Workflow Template/End、工具显式文本 | SSE `token` |
| `json` | Workflow 结构化输出、LLM structured output、工具显式 JSON | 完整 `content_part` |

### 6.2 工具结果契约

现有工具结果需要区分“给模型继续推理的数据”和“最终用户可见内容”：

```ts
export type ToolExecutionResult = {
  toolId: string;
  ok: boolean;

  // 传回模型继续推理。
  output?: ToolJsonValue;

  // 明确允许展示给最终用户的内容。
  contentParts?: ToolContentPart[];

  errorType?: string;
  errorMessage?: string;
  elapsedMs: number;
};
```

禁止把所有工具 `output` 自动显示为 JSON。只有以下输出可以进入最终消息：

- Workflow End 明确返回的结构化结果。
- 模型 structured output 被选为最终回答。
- 工具显式声明的 `contentParts`。

### 6.3 JSON 前端展示

新增 `JsonContentBlock`：

- 格式化展示。
- 折叠和展开。
- 复制 JSON。
- 大对象默认折叠。
- 超过前端展示限制时显示摘要。
- 禁止把 JSON 字符串当作 HTML 注入。

## 7. Storage Service

建议新增独立业务模块：

```text
backend/src/modules/storage/
  storage.module.ts
  storage.service.ts
  storage.controller.ts
  dto/
    storage.dto.ts
  backends/
    storage-backend.ts
    local-storage.backend.ts
  validation/
    file-validation.ts
    remote-file-fetcher.ts
```

### 7.1 Service 接口

```ts
export type SaveStoredFileInput = {
  workspaceId: string;
  name: string;
  mimeType?: string;
  source:
    | { type: "buffer"; data: Uint8Array }
    | { type: "stream"; stream: ReadableStream };
  purpose: "CHAT_OUTPUT" | "TOOL_OUTPUT" | "KNOWLEDGE_DOCUMENT";
  createdByUserId?: string;
  expiresAt?: Date;
};

export type StoredFileDetail = {
  id: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: "PENDING" | "READY" | "FAILED" | "DELETED";
  createdAt: Date;
};

saveFile(input: SaveStoredFileInput): Promise<StoredFileDetail>;
getFile(fileId: string, workspaceId: string): Promise<StoredFileDetail>;
openFile(fileId: string, workspaceId: string): Promise<ReadableStream>;
deleteFile(fileId: string, workspaceId: string): Promise<void>;
```

### 7.2 Backend 接口

```ts
export interface StorageBackend {
  put(storageKey: string, stream: ReadableStream): Promise<void>;
  open(storageKey: string): Promise<ReadableStream>;
  delete(storageKey: string): Promise<void>;
}
```

第一版实现 `LocalStorageBackend`。未来替换 MinIO/S3 时，Chat、Tools 和 Knowledge 不需要修改。

### 7.3 本地存储布局

```text
data/storage/
  <workspace-id>/
    2026/
      09/
        <uuid>
```

约束：

- 原始文件名不能参与真实路径计算。
- `storageKey` 和真实磁盘路径仅限 Storage 模块内部使用。
- 使用临时文件写入，完成后原子移动到正式路径。
- 写入时计算实际大小和 SHA-256。
- MIME 必须由服务端检测，不能完全相信调用方声明。

## 8. 数据库设计

采用“兼容文本 + JSON 内容块 + 强外键附件关系”的组合。

### 8.1 StoredFile

```prisma
enum StoredFileStatus {
  PENDING
  READY
  FAILED
  DELETED
}

enum StoredFilePurpose {
  CHAT_OUTPUT
  TOOL_OUTPUT
  KNOWLEDGE_DOCUMENT
}

model StoredFile {
  id              String            @id @default(uuid()) @db.Uuid
  workspaceId     String            @map("workspace_id") @db.Uuid
  createdByUserId String?           @map("created_by_user_id") @db.Uuid
  purpose         StoredFilePurpose
  status          StoredFileStatus  @default(PENDING)
  name            String
  mimeType        String            @map("mime_type")
  size            BigInt
  sha256          String
  storageBackend  String            @map("storage_backend")
  storageKey      String            @unique @map("storage_key")
  expiresAt       DateTime?         @map("expires_at") @db.Timestamptz(6)
  deletedAt       DateTime?         @map("deleted_at") @db.Timestamptz(6)
  createdAt       DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([workspaceId, createdAt(sort: Desc)])
  @@index([status, expiresAt])
  @@map("stored_files")
}
```

### 8.2 消息字段

`ChatSessionMessage` 和 `ExternalMessage` 都增加：

```prisma
contentParts Json? @map("content_parts") @db.JsonB
```

原有 `content` 保留：

- 作为旧客户端兼容字段。
- 用于标题、搜索、摘要和模型历史。
- 保存所有 `text` 内容拼接后的文本版本。

### 8.3 附件关系

为保证真实外键，内部消息和外部消息分别建立关系表：

```prisma
model ChatMessageAttachment {
  id        String @id @default(uuid()) @db.Uuid
  messageId String @map("message_id") @db.Uuid
  fileId    String @map("file_id") @db.Uuid
  partIndex Int    @map("part_index")

  @@unique([messageId, partIndex])
  @@index([fileId])
  @@map("chat_message_attachments")
}

model ExternalMessageAttachment {
  id        String @id @default(uuid()) @db.Uuid
  messageId String @map("message_id") @db.Uuid
  fileId    String @map("file_id") @db.Uuid
  partIndex Int    @map("part_index")

  @@unique([messageId, partIndex])
  @@index([fileId])
  @@map("external_message_attachments")
}
```

不建议使用 `ownerType + ownerId` 多态关系表，因为 PostgreSQL 无法为多个目标表建立可靠外键。

### 8.4 兼容读取

```ts
function normalizeStoredMessage(message): AgentContentPart[] {
  if (message.contentParts) {
    return validateContentParts(message.contentParts);
  }

  return message.content
    ? [{ type: "text", text: message.content }]
    : [];
}
```

旧消息无需批量迁移。新消息同时写入 `content` 和 `contentParts`。

## 9. image + file 接入

### 9.1 支持来源

| 来源 | 是否允许 | 处理方式 |
| --- | --- | --- |
| Buffer/Stream | 允许 | 直接进入 Storage 校验和写入 |
| 已有 `fileId` | 允许 | 校验 Workspace、状态和用途后复用 |
| HTTPS URL | 受限允许 | 经过 SSRF 防护下载器后落库 |
| 任意本地路径、`file://` | 禁止 | 避免任意文件读取 |
| 临时供应商 URL 直接持久化 | 禁止 | 防止 URL 失效后历史消息不可恢复 |

### 9.2 文件处理流程

```text
工具返回 URL / Stream
  → 校验名称、声明 MIME 和来源
  → 创建 StoredFile(PENDING)
  → 流式写入临时文件，同时计算 size + SHA-256
  → 检测真实 MIME 和图片尺寸
  → 原子移动至正式路径
  → 更新 StoredFile(READY)
  → 持久化消息和附件关系
  → SSE 发送 content_part
```

### 9.3 失败和补偿

- Storage 写入失败：标记 `FAILED`。
- Chat 消息事务失败：文件进入待清理状态。
- 客户端取消：已完成但未引用的文件短期保留后回收。
- 日志写入失败不得导致文件生成主流程失败。
- 只有 `READY` 文件可以进入正式消息。

### 9.4 图片处理

- 校验文件头 Magic Bytes。
- 第一版允许 PNG、JPEG、WebP、GIF。
- SVG 默认作为文件下载，不直接内联展示。
- MIME 与内容不一致时拒绝或修正。
- 限制图片宽高和像素总量，防止图片解压炸弹。

## 10. API 设计

### 10.1 Chat 同步响应

```json
{
  "agentId": "agent-id",
  "content": "兼容文本",
  "parts": [
    {
      "type": "text",
      "text": "兼容文本"
    }
  ]
}
```

### 10.2 内部文件接口

```http
GET /api/v1/files/:fileId
GET /api/v1/files/:fileId/content
GET /api/v1/files/:fileId/content?disposition=inline
```

推荐响应头：

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename*=UTF-8''report.pdf
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
```

`inline` 只允许安全 MIME 白名单，其他类型强制下载。

### 10.3 Widget 与 Service API

```http
GET /api/v1/public/files/:fileId/content?token=<short-lived-token>
GET /api/v1/service/files/:fileId/content
```

公共下载令牌至少绑定：

- `fileId`
- Agent ID
- 外部会话或外部用户
- 下载用途
- 过期时间

Service API 可以使用 Agent API Key，但必须验证文件确实属于该 Agent 的会话。

## 11. 前端工作台

建议新增：

```text
frontend/src/features/chat/components/content/
  MessageContent.tsx
  TextContentBlock.tsx
  JsonContentBlock.tsx
  ImageContentBlock.tsx
  FileContentBlock.tsx
```

展示规则：

| 类型 | 展示行为 |
| --- | --- |
| `text` | 继续使用 `ReactMarkdown`，不解析原始 HTML |
| `json` | 格式化、折叠、展开、复制 |
| `image` | 加载占位、缩略图、点击预览、下载 |
| `file` | 文件名、大小、类型图标和下载按钮 |

单个内容块加载失败不能导致整条消息不可见。

## 12. Widget 改造

Widget 当前是独立 JavaScript 文件，改造内容包括：

- SSE 支持 `content_part`。
- 消息对象从字符串升级为 `{ content, parts }`。
- 增加 JSON、图片和文件渲染函数。
- 文件使用公共鉴权 URL。
- 继续兼容只有 `content` 的旧服务端。

每次修改：

```text
frontend/public/mia-agent-widget.js
```

必须运行：

```bash
npm run build:widget
```

并确认同步生成：

```text
frontend/public/mia-agent-widget.min.js
```

## 13. 安全限制

### 13.1 建议默认限制

| 控制项 | 建议默认值 |
| --- | ---: |
| 单图片大小 | 10 MB |
| 单普通文件大小 | 25 MB |
| 单消息附件数 | 10 |
| 单消息附件总大小 | 50 MB |
| JSON 序列化大小 | 1 MB |
| 外部 URL 重定向 | 最多 3 次 |
| 外部文件下载超时 | 30 秒 |
| 文件名长度 | 255 字符 |
| 公共下载令牌有效期 | 15～60 分钟 |

### 13.2 必须防护

- 路径穿越。
- 响应头注入。
- MIME 欺骗。
- SVG/HTML 主动内容。
- SSRF、localhost、私网地址、云元数据地址。
- DNS 重绑定和重定向到私网。
- 文件大小欺骗和图片解压炸弹。
- 超大 JSON。
- 跨 Workspace、跨 Agent 和跨外部用户越权。
- 已删除、过期或未完成文件访问。
- 日志泄露真实磁盘路径、二进制内容或临时 URL 凭证。

第一版可以不实现完整病毒扫描，但建议为后续预留：

```text
PENDING_SCAN -> READY | QUARANTINED
```

## 14. 分阶段实施计划

### 阶段一：协议和 text/json

预计：3～5 个开发日。

实施内容：

- 定义 `AgentContentPart`。
- 扩展 Agent Runtime 最终结果。
- 新增 `content_part` SSE。
- 消息增加 `contentParts`。
- 完成 JSON 持久化和前端展示。
- 保持旧 `content` 兼容。
- 补 Chat、Runtime、Workflow、Tools 测试。

验收标准：

- 旧文本对话行为不变。
- JSON 可以流转、恢复、复制。
- 旧客户端仍能收到完整文本。

### 阶段二：Storage 和附件表

预计：4～6 个开发日。

实施内容：

- 新建 Storage 模块。
- 实现 `LocalStorageBackend`。
- 新建 `stored_files`。
- 新建内部和外部消息附件关系表。
- 实现内部下载接口。
- 实现事务补偿和孤儿文件清理。
- 补文件权限测试。

验收标准：

- 文件不以 Base64 进入消息或数据库 JSON。
- 文件路径不对外暴露。
- 跨 Workspace 无法访问。

### 阶段三：image/file 输出

预计：4～6 个开发日。

实施内容：

- 工具输出增加 `contentParts`。
- 实现 URL 安全下载。
- 文件类型、大小和图片尺寸校验。
- 前端图片预览和文件下载。
- 持久会话恢复附件。
- 取消与失败清理。

验收标准：

- 工具可以输出图片和 PDF。
- 刷新页面后仍可预览或下载。
- 供应商临时 URL 失效不影响历史消息。

### 阶段四：API、Widget 和安全收尾

预计：4～7 个开发日。

实施内容：

- Service API 返回 `parts`。
- Widget 渲染四类内容。
- 外部文件访问令牌。
- SSRF 防护。
- 过期文件清理。
- 日志脱敏。
- 限额与错误码。
- 完整回归测试。

总体预计：15～24 个开发日。

## 15. 测试策略

### 15.1 单元测试

- 内容块 Schema 校验。
- 文本兼容字段生成。
- 未知类型降级。
- 工具 `output` 与 `contentParts` 分离。
- Storage 文件名规范化、大小限制、MIME 检测和状态流转。
- URL 私网、重定向、超时和超限拒绝。

### 15.2 集成测试

- SSE `token -> content_part -> message_end` 顺序。
- 内部会话、ExternalMessage、Service API 和 Widget 历史恢复。
- 消息事务失败、用户取消、Storage 失败后的补偿。
- 孤儿文件清理。
- 跨 Workspace、Agent 和外部用户下载拒绝。
- 旧客户端忽略 `content_part` 后仍可展示 `content`。

## 16. 发布与回滚

1. 先部署新增字段和新表，全部采用向后兼容的 additive migration。
2. 部署后端双写 `content/contentParts`，新事件先由 feature flag 控制。
3. 部署工作台和 Widget 的新渲染能力。
4. 打开 `content_part` 输出。
5. 观察 Storage 失败率、孤儿文件数、下载失败率和消息兼容情况。

回滚时关闭新协议事件，旧 `content` 字段仍能保证客户端运行。不得在应用回滚时删除 Storage 文件和附件关系表。

## 17. 建议错误码

| 错误码 | 含义 |
| --- | --- |
| `STORAGE_FILE_NOT_FOUND` | 文件不存在、已删除或无权访问 |
| `STORAGE_FILE_TOO_LARGE` | 单文件或单消息文件总量超限 |
| `STORAGE_UNSUPPORTED_MEDIA_TYPE` | 文件类型不支持 |
| `STORAGE_REMOTE_FETCH_BLOCKED` | 远程 URL 被 SSRF 策略阻止 |
| `STORAGE_REMOTE_FETCH_FAILED` | 远程文件下载失败或超时 |
| `CHAT_CONTENT_PART_INVALID` | 内容块结构或字段不合法 |
| `CHAT_CONTENT_LIMIT_EXCEEDED` | JSON、内容块数量或总体大小超限 |

## 18. 建议实施文件范围

```text
backend/prisma/schema.prisma
backend/prisma/migrations/<new_migration>/migration.sql

backend/src/modules/agent_runtime/dto/
backend/src/modules/agent_runtime/agent-runtime.service.ts

backend/src/modules/chat/dto/
backend/src/modules/chat/chat.service.ts
backend/src/modules/chat/chat-sessions.service.ts
backend/src/modules/chat/chat-streams.service.ts

backend/src/modules/tools/dto/
backend/src/modules/tools/tools.service.ts
backend/src/modules/tools/http/
backend/src/modules/mcp/

backend/src/modules/storage/

backend/src/modules/external_access/

frontend/src/features/chat/api.ts
frontend/src/features/chat/types.ts
frontend/src/features/chat/ChatPage.tsx
frontend/src/features/chat/components/content/

frontend/public/mia-agent-widget.js
frontend/public/mia-agent-widget.min.js
```

## 19. 实施前确认项

编码开始前建议确认：

- `json` 是否只支持最终回答，还是允许与文本混排。
- HTTP Tool 如何配置用户可见 `contentParts` 映射。
- MCP Tool 的文件结果如何映射为 `PendingFileContentPart`。
- 文件默认保留期限和是否允许永久文件。
- Workspace 是否需要文件总配额。
- Service API 返回直接下载 URL，还是只返回 `fileId` 和独立下载接口。
- 图片预览是否需要第一版同步生成缩略图。

