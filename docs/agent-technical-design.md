# Agent 模块技术开发文档

## 1. 模块目标

Agent 模块负责管理 AI 助手配置。v0.1 只实现 Agent CRUD，不执行模型调用，不做 RAG，不绑定工具。

后端模块路径：

```text
backend/src/modules/agents/
```

前端模块路径：

```text
frontend/src/features/agents/
```

## 2. 数据表设计

### 2.1 agents

用途：存储 Agent 核心配置。

```sql
CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system_prompt text NOT NULL,
  model_config_id uuid NOT NULL REFERENCES model_configs(id),
  temperature numeric(3,2) NOT NULL DEFAULT 0.70,
  max_tokens integer,
  timeout_seconds integer NOT NULL DEFAULT 120,
  history_turns integer NOT NULL DEFAULT 6,
  generation_params jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

### 2.2 索引

```sql
CREATE INDEX idx_agents_created_at
ON agents (created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_agents_model_config_id
ON agents (model_config_id);

CREATE INDEX idx_agents_enabled_created_at
ON agents (enabled, created_at DESC)
WHERE deleted_at IS NULL;
```

### 2.3 Prisma Model

```prisma
model Agent {
  id               String      @id @default(uuid()) @db.Uuid
  name             String
  description      String      @default("")
  systemPrompt     String      @map("system_prompt") @db.Text
  modelConfigId    String      @map("model_config_id") @db.Uuid
  temperature      Decimal     @default(0.70) @db.Decimal(3, 2)
  maxTokens        Int?        @map("max_tokens")
  timeoutSeconds   Int         @default(120) @map("timeout_seconds")
  historyTurns     Int         @default(6) @map("history_turns")
  generationParams Json?       @map("generation_params") @db.JsonB
  enabled          Boolean     @default(true)
  createdAt        DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime    @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt        DateTime?   @map("deleted_at") @db.Timestamptz(6)
  modelConfig      ModelConfig @relation(fields: [modelConfigId], references: [id])

  @@index([createdAt(sort: Desc)], map: "idx_agents_created_at")
  @@index([modelConfigId], map: "idx_agents_model_config_id")
  @@index([enabled, createdAt(sort: Desc)], map: "idx_agents_enabled_created_at")
  @@map("agents")
}
```

### 2.4 表关系

当前 v0.1：

```text
model_configs 1 -- N agents
```

后续扩展：

```text
agents N -- N knowledge_bases via agent_knowledge_bases
agents N -- N tools via agent_tools
agents 1 -- N chat_sessions
agents 1 -- N llm_call_logs
```

## 3. 暂不建的表

以下表先不建，等对应模块存在后再落真实外键：

```text
agent_knowledge_bases
agent_tools
```

未来设计：

```sql
CREATE TABLE agent_knowledge_bases (
  agent_id uuid NOT NULL REFERENCES agents(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, knowledge_base_id)
);

CREATE INDEX idx_agent_knowledge_bases_knowledge_base_id
ON agent_knowledge_bases (knowledge_base_id);
```

```sql
CREATE TABLE agent_tools (
  agent_id uuid NOT NULL REFERENCES agents(id),
  tool_id uuid NOT NULL REFERENCES tools(id),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool_id)
);

CREATE INDEX idx_agent_tools_tool_id
ON agent_tools (tool_id);
```

## 4. 后端文件结构

```text
backend/src/modules/agents/
  agents.module.ts
  agents.controller.ts
  agents.service.ts
  dto/
    agent.dto.ts
```

需要在 `backend/src/app.module.ts` 注册：

```typescript
imports: [PrismaModule, HealthModule, ModelProvidersModule, AgentsModule]
```

## 5. DTO 设计

### 5.1 AgentCreateDto

```typescript
export type AgentCreateDto = {
  name?: string;
  description?: string;
  systemPrompt?: string;
  modelConfigId?: string;
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
  historyTurns?: number;
  generationParams?: Record<string, unknown> | null;
  enabled?: boolean;
};
```

### 5.2 AgentUpdateDto

```typescript
export type AgentUpdateDto = Partial<AgentCreateDto>;
```

### 5.3 AgentQueryDto

```typescript
export type AgentQueryDto = {
  page?: string;
  pageSize?: string;
  enabled?: string;
};
```

### 5.4 AgentListItem

```typescript
export type AgentListItem = {
  id: string;
  name: string;
  description: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};
```

### 5.5 AgentDetail

```typescript
export type AgentDetail = AgentListItem & {
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  generationParams: Record<string, unknown> | null;
};
```

### 5.6 AgentRuntimeConfig

供后续 Chat 模块使用，不一定暴露给前端。

```typescript
export type AgentRuntimeConfig = {
  agentId: string;
  name: string;
  systemPrompt: string;
  modelConfigId: string;
  modelName: string;
  providerId: string;
  providerType: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number | null;
  timeoutSeconds: number;
  historyTurns: number;
  generationParams: Record<string, unknown> | null;
  knowledgeBaseIds: string[];
  toolIds: string[];
};
```

v0.1 中：

```text
knowledgeBaseIds = []
toolIds = []
```

## 6. 接口设计

所有普通 JSON 接口返回 `Result<T>`。

### 6.1 Agent 列表

```text
GET /api/v1/agents?page=1&pageSize=20
```

可选参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| page | number string | 页码，从 1 开始 |
| pageSize | number string | 默认 20，最大 100 |
| enabled | string | 可选，`true` / `false` |

响应：

```typescript
Result<PageResult<AgentListItem>>
```

### 6.2 创建 Agent

```text
POST /api/v1/agents
```

请求体：

```json
{
  "name": "HR 助手",
  "description": "回答公司制度问题",
  "systemPrompt": "你是公司 HR 助手...",
  "modelConfigId": "uuid",
  "temperature": 0.7,
  "maxTokens": 2048,
  "timeoutSeconds": 120,
  "historyTurns": 6,
  "generationParams": null,
  "enabled": true
}
```

响应：

```typescript
Result<AgentDetail>
```

### 6.3 Agent 详情

```text
GET /api/v1/agents/{id}
```

响应：

```typescript
Result<AgentDetail>
```

### 6.4 更新 Agent

```text
PUT /api/v1/agents/{id}
```

请求体：

```typescript
AgentUpdateDto
```

响应：

```typescript
Result<AgentDetail>
```

### 6.5 删除 Agent

```text
DELETE /api/v1/agents/{id}
```

响应：

```typescript
Result<null>
```

## 7. 业务校验规则

### 7.1 创建校验

- `name` 必填，trim 后不能为空。
- `systemPrompt` 必填，trim 后不能为空。
- `modelConfigId` 必填。
- `modelConfigId` 必须存在。
- 绑定模型必须满足：

```text
model_configs.id = modelConfigId
model_configs.deleted_at IS NULL
model_configs.enabled = true
model_configs.model_type = CHAT
```

- `temperature` 默认 0.70，允许范围 0 到 2。
- `maxTokens` 可空；如果传入，必须是正整数。
- `timeoutSeconds` 默认 120，允许范围 1 到 300。
- `historyTurns` 默认 6，允许范围 0 到 20。
- `generationParams` 可空；如果传入，必须是普通对象。
- `enabled` 默认 true。
- `description` 默认空字符串。

### 7.2 更新校验

- Agent 必须存在且未删除。
- 不传的字段不更新。
- 如果传 `name`，不能为空。
- 如果传 `systemPrompt`，不能为空。
- 如果传 `modelConfigId`，必须校验模型存在、启用且类型为 `CHAT`。
- 如果传数值参数，必须校验范围。
- 如果传 `generationParams`，必须是普通对象或 null。

### 7.3 删除校验

- Agent 必须存在且未删除。
- v0.1 暂无关联表需要检查。
- 删除采用软删除：

```text
deletedAt = now()
enabled = false
```

## 8. 错误码

Agent 模块使用 `3000-3999`。

建议：

```typescript
agent: {
  notFound: 3001,
  invalidModelConfig: 3002,
}
```

错误响应示例：

```json
{
  "code": 3001,
  "message": "agent not found",
  "data": null
}
```

## 9. 后端实现流程

### 9.1 创建

```text
AgentsController.createAgent()
-> AgentsService.createAgent()
-> validate payload
-> validate modelConfig is enabled CHAT model
-> prisma.agent.create()
-> toAgentDetail()
-> Result<AgentDetail>
```

### 9.2 查询列表

```text
AgentsController.listAgents()
-> AgentsService.listAgents()
-> normalizePageQuery()
-> prisma.agent.findMany()
-> prisma.agent.count()
-> PageResult<AgentListItem>
```

### 9.3 查询详情

```text
AgentsController.getAgent()
-> AgentsService.getAgent()
-> prisma.agent.findFirst({ id, deletedAt: null })
-> toAgentDetail()
-> Result<AgentDetail>
```

### 9.4 更新

```text
AgentsController.updateAgent()
-> AgentsService.updateAgent()
-> validate agent exists
-> validate payload
-> validate modelConfig if changed
-> prisma.agent.update()
-> toAgentDetail()
-> Result<AgentDetail>
```

### 9.5 删除

```text
AgentsController.deleteAgent()
-> AgentsService.deleteAgent()
-> validate agent exists
-> prisma.agent.update({ deletedAt, enabled: false })
-> Result<null>
```

## 10. 前端实现

### 10.1 文件结构

```text
frontend/src/features/agents/
  api.ts
  AgentsPage.tsx
```

### 10.2 前端 API

```typescript
listAgents(page, pageSize)
createAgent(payload)
getAgent(id)
updateAgent(id, payload)
deleteAgent(id)
```

页面不直接写 `fetch`，统一通过 `features/agents/api.ts` 调用。

### 10.3 页面功能

- Agent 列表。
- 创建 Agent 表单。
- 编辑 Agent 表单。
- 删除 Agent。
- 选择 Chat Model。
- loading / error / success 状态。

## 11. 验证方式

### 11.1 静态验证

```bash
npm run prisma:generate
DATABASE_URL=postgresql://mia:mia@127.0.0.1:5432/mia npm --prefix backend exec prisma validate
npm run typecheck
npm run build
```

### 11.2 数据库验证

```bash
npm run db:up
npm run prisma:deploy
```

### 11.3 curl 验证

先创建 Chat Model Config，再创建 Agent。

```bash
curl -s http://127.0.0.1:8000/api/v1/agents
```

创建 Agent：

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "HR 助手",
    "description": "回答公司制度问题",
    "systemPrompt": "你是公司 HR 助手。",
    "modelConfigId": "替换为 CHAT model config id",
    "temperature": 0.7,
    "timeoutSeconds": 120,
    "historyTurns": 6,
    "enabled": true
  }'
```

### 11.4 浏览器验收

- 打开前端。
- 进入 Agent 页面。
- 创建 Agent。
- 编辑 Agent。
- 删除 Agent。
- 刷新页面确认数据一致。

## 12. 注意事项

- 不要在 Agent Service 调用 LLM。
- 不要在 Agent 创建/更新时测试 Provider 连通性。
- 不要把 Knowledge/Tools 关系提前塞进 `agents` 表数组字段。
- `system_prompt` 必须用 `text`。
- 通用模型参数用独立字段。
- 模型特有参数放 `generation_params jsonb`。
- Agent 删除必须软删除。
- 当前不做 Agent name 唯一。
- 后续 Auth/User 完成后，再补 `created_by`、`updated_by` 和同一创建者下 name 唯一。

