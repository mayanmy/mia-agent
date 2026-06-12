# Agent 公开 WebApp 技术开发文档

## 1. 模块目标

Agent 公开 WebApp 用于把已配置的 Agent 发布为独立公开页面。外部用户无需登录 Mia 工作台即可访问该页面，并通过 Public Chat API 与指定 Agent 对话。

后端涉及模块：

```text
backend/src/modules/agents/
backend/src/modules/chat/
backend/src/modules/logs/
backend/src/core/
```

前端新增模块：

```text
frontend/src/features/public-agent/
```

## 2. 模块边界

### 2.1 agents

负责 Agent 发布配置：

- 创建 / 更新公开发布配置。
- 生成和校验 slug。
- 校验 Agent 是否允许公开访问。
- 返回公开运行配置。
- 管理访问密码 hash。
- 管理自定义域名配置。

不负责：

- 不执行对话。
- 不调用模型。
- 不写 chat message。
- 不执行工具。

### 2.2 chat

负责公开对话入口：

- Public Chat SSE。
- 公开访问会话校验。
- 对话编排。
- 调用现有 Agent/RAG/Model/Tools 能力。
- 对话 source 标记为 `public_site`。

不负责：

- 不管理发布配置。
- 不直接保存密码。
- 不处理自定义域名归属验证。

### 2.3 logs

负责记录公开访问日志：

- 公开页访问。
- 密码验证成功 / 失败。
- 公开对话开始 / 成功 / 失败。
- 公开工具调用日志。
- 公开模型调用错误。

### 2.4 frontend public-agent

负责独立公开页：

- `/a/:slug` 路由。
- 密码页。
- 聊天消息列表。
- SSE 消费。
- 工具调用展示。
- 移动端布局。

不复用后台页面壳，不展示管理入口。

## 3. 数据表设计

### 3.1 agent_public_sites

用途：存储 Agent 公开发布配置。

v1 字段：

```sql
CREATE TABLE agent_public_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

v1.1 增加：

```sql
ALTER TABLE agent_public_sites
ADD COLUMN password_hash text;
```

v1.2 增加：

```sql
ALTER TABLE agent_public_sites
ADD COLUMN title text,
ADD COLUMN description text,
ADD COLUMN welcome_message text,
ADD COLUMN suggested_questions jsonb,
ADD COLUMN theme_config jsonb;
```

v2 增加：

```sql
ALTER TABLE agent_public_sites
ADD COLUMN custom_domain text;
```

v2.1 增加：

```sql
ALTER TABLE agent_public_sites
ADD COLUMN expires_at timestamptz,
ADD COLUMN daily_message_limit integer,
ADD COLUMN allowed_origins jsonb;
```

索引：

```sql
CREATE UNIQUE INDEX uq_agent_public_sites_slug
ON agent_public_sites (slug)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_agent_public_sites_agent_id
ON agent_public_sites (agent_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_agent_public_sites_enabled_created_at
ON agent_public_sites (enabled, created_at DESC)
WHERE deleted_at IS NULL;
```

v2 自定义域名索引：

```sql
CREATE UNIQUE INDEX uq_agent_public_sites_custom_domain
ON agent_public_sites (custom_domain)
WHERE custom_domain IS NOT NULL AND deleted_at IS NULL;
```

### 3.2 public_access_logs

用途：记录公开页访问和公开访问控制事件。

可在 v1.1 引入，也可以 v1 先写入现有 logs 模块通用日志。

```sql
CREATE TABLE public_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  public_site_id uuid REFERENCES agent_public_sites(id),
  agent_id uuid REFERENCES agents(id),
  visitor_id text,
  event_type text NOT NULL,
  status text NOT NULL,
  ip_hash text,
  user_agent text,
  error_type text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

索引：

```sql
CREATE INDEX idx_public_access_logs_created_at
ON public_access_logs (created_at DESC);

CREATE INDEX idx_public_access_logs_public_site_created_at
ON public_access_logs (public_site_id, created_at DESC);

CREATE INDEX idx_public_access_logs_agent_created_at
ON public_access_logs (agent_id, created_at DESC);
```

### 3.3 chat 相关字段

如果现有 `chat_sessions` / `chat_messages` 支持来源字段，公开对话复用现有表。

建议补充：

```text
source: "console" | "widget" | "public_site"
public_site_id
visitor_id
```

如果暂不改表，至少在日志 payload 中记录这些字段。

## 4. Prisma Model 建议

```prisma
model AgentPublicSite {
  id                 String    @id @default(uuid()) @db.Uuid
  agentId            String    @map("agent_id") @db.Uuid
  slug               String
  enabled            Boolean   @default(false)
  passwordHash       String?   @map("password_hash")
  title              String?
  description        String?
  welcomeMessage     String?   @map("welcome_message")
  suggestedQuestions Json?     @map("suggested_questions") @db.JsonB
  themeConfig        Json?     @map("theme_config") @db.JsonB
  customDomain       String?   @map("custom_domain")
  expiresAt          DateTime? @map("expires_at") @db.Timestamptz(6)
  dailyMessageLimit  Int?      @map("daily_message_limit")
  allowedOrigins     Json?     @map("allowed_origins") @db.JsonB
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt          DateTime? @map("deleted_at") @db.Timestamptz(6)
  agent              Agent     @relation(fields: [agentId], references: [id])

  @@unique([slug], map: "uq_agent_public_sites_slug")
  @@unique([agentId], map: "uq_agent_public_sites_agent_id")
  @@index([enabled, createdAt(sort: Desc)], map: "idx_agent_public_sites_enabled_created_at")
  @@map("agent_public_sites")
}
```

部分唯一索引需要在 migration SQL 中手写，Prisma schema 中不要只依赖普通 `@@unique`，避免软删除后无法重新使用 slug。

## 5. 后端文件结构

### 5.1 agents 模块

```text
backend/src/modules/agents/
  agents.controller.ts
  agents.service.ts
  dto/
    agent-public-site.dto.ts
```

新增 service 方法：

```typescript
getAgentPublicSite(agentId: string): Promise<AgentPublicSiteDetail>
upsertAgentPublicSite(agentId: string, payload: AgentPublicSiteUpdateDto): Promise<AgentPublicSiteDetail>
getPublicAgentRuntimeConfig(slug: string): Promise<PublicAgentRuntimeConfig>
getPublicAgentRuntimeConfigByHost(host: string): Promise<PublicAgentRuntimeConfig>
verifyPublicSitePassword(slug: string, password: string): Promise<PublicSiteAuthResult>
```

### 5.2 chat 模块

```text
backend/src/modules/chat/
  public-chat.controller.ts
  public-chat.service.ts
  dto/
    public-chat.dto.ts
```

Public Chat service 负责把公开请求转换成现有 Chat 编排可用的上下文。

### 5.3 core

```text
backend/src/core/
  public-token.ts
  password.ts
  rate-limit.ts
```

第一版可以先使用轻量实现：

- `crypto.randomUUID()` 生成 visitorId。
- `crypto.subtle` 或 Node `crypto` 做 password hash。
- 内存限流，后续替换 Redis。

## 6. DTO 设计

### 6.1 AgentPublicSiteUpdateDto

```typescript
export type AgentPublicSiteUpdateDto = {
  enabled?: boolean;
  slug?: string;
  title?: string | null;
  description?: string | null;
  password?: string | null;
  clearPassword?: boolean;
  welcomeMessage?: string | null;
  suggestedQuestions?: string[];
  themeConfig?: Record<string, unknown> | null;
};
```

### 6.2 AgentPublicSiteDetail

```typescript
export type AgentPublicSiteDetail = {
  id: string;
  agentId: string;
  slug: string;
  enabled: boolean;
  publicUrl: string;
  title: string;
  description: string;
  hasPassword: boolean;
  customDomain: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### 6.3 PublicAgentProfile

公开页面可读取的 Agent 信息，不能包含内部 Prompt、模型密钥和管理配置。

```typescript
export type PublicAgentProfile = {
  slug: string;
  title: string;
  description: string;
  enabled: boolean;
  requiresPassword: boolean;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
  themeConfig?: Record<string, unknown>;
};
```

### 6.4 PublicChatStreamDto

```typescript
export type PublicChatStreamDto = {
  message?: string;
  visitorId?: string;
  publicSessionToken?: string;
  history?: {
    role: "user" | "assistant";
    content: string;
  }[];
};
```

## 7. API 设计

### 7.1 管理端 API

需要登录 Mia 工作台。

```text
GET /api/v1/agents/:agentId/public-site
PUT /api/v1/agents/:agentId/public-site
POST /api/v1/agents/:agentId/public-site/regenerate-slug
```

说明：

- `GET` 查询当前 Agent 发布配置。
- `PUT` 创建或更新发布配置。
- `regenerate-slug` 用于 v2.1，一键重置公开链接。

### 7.2 公开端 API

不需要 Mia 登录，但需要 public access guard。

```text
GET  /api/v1/public/agents/:slug
POST /api/v1/public/agents/:slug/auth
POST /api/v1/public/agents/:slug/chat/stream
```

说明：

- `GET` 返回公开页配置。
- `auth` 验证访问密码。
- `chat/stream` 发起公开 SSE 对话。

### 7.3 自定义域名 API

v2 实现。

```text
GET  /api/v1/public/agent
POST /api/v1/agents/:agentId/public-site/domain
POST /api/v1/agents/:agentId/public-site/domain/verify
DELETE /api/v1/agents/:agentId/public-site/domain
```

`GET /api/v1/public/agent` 根据 `Host` header 解析公开 Agent。

## 8. SSE 事件

Public Chat 复用现有 SSE 事件：

```text
message_start
retrieval_start
retrieval_result
token
tool_call
tool_result
message_end
error
ping
```

公开 API 需要保证错误信息可读：

```json
{
  "type": "error",
  "data": {
    "code": "public_site_disabled",
    "message": "该公开访问链接已停用"
  }
}
```

建议错误码：

```text
public_site_not_found
public_site_disabled
public_site_expired
public_site_password_required
public_site_password_invalid
public_site_rate_limited
agent_disabled
model_unavailable
chat_failed
```

## 9. 公开访问校验流程

### 9.1 v1 无密码流程

```text
GET /a/:slug
  -> 前端请求 GET /api/v1/public/agents/:slug
  -> 后端校验 slug、enabled、agent.enabled
  -> 返回 PublicAgentProfile
  -> 用户发送消息
  -> POST /api/v1/public/agents/:slug/chat/stream
  -> public-chat.service 再次校验发布状态
  -> 调用 chat 编排
```

### 9.2 v1.1 密码流程

```text
GET /api/v1/public/agents/:slug
  -> 返回 requiresPassword=true
  -> 前端展示密码页
POST /api/v1/public/agents/:slug/auth
  -> 校验 password_hash
  -> 返回 publicSessionToken
POST /api/v1/public/agents/:slug/chat/stream
  -> 校验 publicSessionToken
  -> 继续对话
```

public session token 内容建议：

```text
public_site_id
visitor_id
expires_at
signature
```

第一版可以用服务端签名 token；如果要支持主动失效和统计，可落库或使用 Redis。

## 10. 前端结构

```text
frontend/src/features/public-agent/
  PublicAgentPage.tsx
  api.ts
  types.ts
  public-agent.less
  components/
    PublicAgentHeader.tsx
    PublicPasswordGate.tsx
    PublicChatTranscript.tsx
    PublicChatMessageItem.tsx
    PublicChatComposer.tsx
    PublicToolEventCard.tsx
  hooks/
    usePublicChatStream.ts
    usePublicAgentAccess.ts
    usePublicAutoScroll.ts
```

可复用项：

- `features/chat/components/ToolEventCard.tsx`
- `features/chat` 中的 SSE 解析工具。
- 自动滚动 hook。

不直接复用项：

- 后台 `ChatPage` 整页。
- 后台 Agent 选择器。
- 后台上传控件，除非 v1.2 明确支持公开上传。

## 11. 前端路由

在 Vite/React 路由中新增：

```text
/a/:slug
```

该路由使用独立 layout：

```text
PublicAgentLayout
  -> PublicAgentPage
```

不要嵌套后台 shell。

## 12. 安全设计

### 12.1 slug

- slug 全局唯一。
- 默认使用随机短 ID 或可读短码。
- 不使用自增 ID。
- 支持管理员重置。

### 12.2 密码

- 明文只在创建 / 更新请求中短暂出现。
- 后端只保存 hash。
- API 不返回 password 或 password_hash。
- 日志不记录密码。

### 12.3 限流

v1 最小限流：

```text
按 ip_hash + slug 限制每分钟请求数
按 visitor_id + slug 限制并发 SSE
```

v2.1 增强：

```text
按 public_site_id 每日消息数限制
按 visitor_id 每日消息数限制
```

### 12.4 工具调用

公开 Agent 默认只使用该 Agent 已绑定并启用的工具。

高风险工具必须额外确认：

- `http_request` 继续遵守 allowlist。
- 禁止公开页面通过参数绕过 allowlist。
- 工具失败原因通过 `tool_result` 返回，但不暴露内部堆栈。

### 12.5 CORS 与 Host

v1 公开链接走 Mia 同域，不需要额外 CORS。

v2 自定义域名时：

- 反向代理需要允许 Host。
- 后端根据 Host 解析 public site。
- CORS 只允许已绑定域名或明确 allowed origins。

## 13. 日志设计

公开对话需要携带：

```text
request_id
source=public_site
public_site_id
agent_id
visitor_id
ip_hash
user_agent
slug
```

工具调用日志补充：

```text
source=public_site
public_site_id
visitor_id
```

密码验证日志：

```text
event_type=public_password_verify
status=success | failed
error_type=password_invalid
```

## 14. 开发版本拆分

### 14.1 v1 开发任务

后端：

- 新增 `agent_public_sites` 表。
- 新增 Agent 发布配置 DTO。
- 新增管理端发布配置接口。
- 新增 Public Agent profile 接口。
- 新增 Public Chat SSE 接口。
- Public Chat 复用现有 Chat 编排。
- 日志标记 `source=public_site`。
- 基础限流。

前端：

- Agent 编辑页新增「发布」Tab。
- 展示公开链接和复制按钮。
- 新增 `/a/:slug` 页面。
- 新增公开聊天 UI。
- 消费 Public Chat SSE。

测试：

- 开启公开访问成功。
- 关闭公开访问后不可访问。
- slug 不存在返回 404 类业务错误。
- Agent 停用后不可访问。
- Public Chat 主路径成功。

### 14.2 v1.1 开发任务

后端：

- 增加 password hash 字段。
- 实现密码设置 / 清除。
- 实现公开密码验证接口。
- 实现 public session token。
- Public Chat 校验 token。
- 记录密码验证日志。

前端：

- 发布配置支持设置 / 清除密码。
- 公开页支持密码输入。
- 密码错误可读。
- 通过后进入聊天。

测试：

- 无密码时可直接聊天。
- 有密码未验证时不能聊天。
- 密码错误不能聊天。
- 密码正确后可聊天。
- API 不返回 password_hash。

### 14.3 v1.2 开发任务

后端：

- 发布配置增加 title、description、welcomeMessage、suggestedQuestions、themeConfig。
- Public Agent profile 返回展示配置。

前端：

- 公开页展示标题、描述、欢迎语。
- 支持建议问题快捷发送。
- 移动端适配。
- 复用工具调用卡片和失败详情。

测试：

- 配置为空时使用 Agent 默认信息。
- 建议问题点击后可发送。
- 移动端布局不溢出。

### 14.4 v2 开发任务

后端：

- 增加 custom_domain 字段或独立 domain 表。
- 实现域名绑定接口。
- 实现域名验证。
- 根据 Host 解析 public site。
- CORS / allowed host 校验。

前端：

- 发布配置支持自定义域名。
- 展示 DNS 配置说明。
- 展示验证状态。

部署：

- 补充反向代理配置示例。
- 补充 TLS 配置说明。

测试：

- 未验证域名不可启用。
- Host 命中后可访问对应 Agent。
- 删除域名后访问失效。

## 15. 推荐实施顺序

```text
1. 后端 agent_public_sites 表和管理接口
2. Agent 编辑页发布 Tab
3. Public Agent profile 接口
4. /a/:slug 前端页面
5. Public Chat SSE 主路径
6. 日志和限流
7. 密码保护
8. 公开页体验增强
9. 自定义域名
```

## 16. 验证命令

本仓库默认使用 Node 22。

```bash
npm run check
npm --prefix backend run test
npm run build
```

涉及 Prisma 变更时：

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate
```
