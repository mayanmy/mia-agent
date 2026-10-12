# Mia 项目空间隔离技术方案

## 1. 方案状态

- 状态：已实施，本文按当前代码维护。
- 适用版本：Mia 从单团队共享数据升级为多项目空间隔离。
- 产品术语：界面统一使用“项目空间”；代码、数据库和 API 使用 `Workspace`。
- 核心目标：不同项目空间可以邀请不同用户加入，同一用户可以加入多个项目空间；所有业务数据默认只在所属项目空间内可见和可操作。

本方案不引入 Guest，不引入复杂自定义 RBAC，也不拆微服务。Mia 继续使用 PostgreSQL、Prisma 和 NestJS 模块化单体，通过共享数据库中的 `workspace_id` 实现行级租户隔离。

## 2. 核心设计结论

```text
User（全局登录身份，邮箱全局唯一）
  └─ WorkspaceMember（项目空间成员关系与空间内角色）
       └─ Workspace（一级数据和权限边界）
            └─ Model / Agent / Knowledge / Tool / MCP / Skill / Workflow / Chat / Logs
```

必须遵守以下约束：

1. `User` 只表示全局账号，项目权限不再由 `User.role` 决定。
2. 角色属于 `WorkspaceMember`，固定为 `OWNER / MANAGER / MEMBER`。
3. 一个用户可以加入多个项目空间，但每个业务请求只能作用于一个明确的当前项目空间。
4. 前端可以提交 `X-Workspace-ID`，服务端必须验证当前用户是该空间的有效成员后才能使用，不能直接信任 Header。
5. Controller 获取可信的 `CurrentWorkspace`，Service 显式接收 `workspaceId`；不得依赖全局变量、页面状态或仅凭资源 ID 推断空间。
6. 跨空间资源统一返回 404，避免泄露目标 ID 是否存在。
7. 外部 Agent/Widget 通过发布 Token 或 API Key 解析所属 Agent 和 Workspace，不要求工作台成员上下文。

## 3. 角色与权限

```prisma
enum WorkspaceRole {
  OWNER
  MANAGER
  MEMBER
}
```

| 能力                                 | OWNER | MANAGER | MEMBER |
| ------------------------------------ | ----- | ----- | ------ |
| 查看和使用空间内已启用资源           | 是    | 是    | 是     |
| 创建、编辑 Agent、知识库             | 是    | 是    | 否     |
| 管理模型、工具、MCP、Skill、Workflow | 是    | 是    | 否     |
| 查看全空间日志和 Run Trace           | 是    | 是    | 否     |
| 邀请成员、调整 MEMBER                | 是    | 是    | 否     |
| 任命或移除 MANAGER                   | 是    | 否    | 否     |
| 转让所有权、删除项目空间             | 是    | 否    | 否     |

`OWNER` 每个项目空间必须且只能有一个有效成员。`MANAGER` 不能降级、移除或替换 `OWNER`。成员被移除后，下一次请求必须立即失去该空间访问权限。

迁移期间保留 `User.role` 仅用于兼容旧数据和平台启动，不再作为业务 Controller 的最终授权依据；全部空间内接口迁移完成后再删除该字段。

## 4. 数据模型

### 4.1 新增根模型

```prisma
model Workspace {
  id          String            @id @default(uuid()) @db.Uuid
  name        String
  description String            @default("") @db.Text
  createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt   DateTime?         @map("deleted_at") @db.Timestamptz(6)
  members     WorkspaceMember[]

  @@index([deletedAt, createdAt(sort: Desc)])
  @@map("workspaces")
}

model WorkspaceMember {
  workspaceId String        @map("workspace_id") @db.Uuid
  userId      String        @map("user_id") @db.Uuid
  role        WorkspaceRole @default(MEMBER)
  joinedAt    DateTime      @default(now()) @map("joined_at") @db.Timestamptz(6)
  removedAt   DateTime?     @map("removed_at") @db.Timestamptz(6)
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([workspaceId, userId])
  @@index([userId, removedAt])
  @@index([workspaceId, role, removedAt])
  @@map("workspace_members")
}
```

`UserInvitation` 增加 `workspace_id` 和 `workspace_role`。邀请唯一性从全局邮箱改为“同一空间内只能有一条未结束邀请”。已有账号接受邀请时只新增成员关系；新邮箱接受邀请时创建全局账号并加入目标空间。

### 4.2 必须直接保存 workspace_id 的表

以下表是根资源、高频查询、日志、异步任务或安全边界，必须直接保存非空 `workspace_id`：

- `model_providers`
- `model_configs`
- `default_model_settings`
- `agents`
- `workflows`
- `workflow_versions`
- `skills`
- `agent_api_keys`
- `external_end_users`
- `external_conversations`
- `http_tools`
- `tool_secrets`
- `mcp_servers`
- `mcp_server_secrets`
- `mcp_oauth_authorizations`
- `mcp_server_tools`
- `mcp_tool_approvals`
- `mcp_sync_runs`
- `chat_sessions`
- `tool_call_logs`
- `agent_runs`
- `knowledge_bases`
- `knowledge_documents`
- `knowledge_chunks`
- 所有 `knowledge_embeddings*` 维度表

纯子表仍可经父表追溯，但高频隔离表保留冗余字段可降低遗漏过滤的风险，并为未来分库、日志归档和向量库迁移保留边界。

### 4.3 唯一约束和索引

所有原本具有“团队内唯一”语义的约束必须改为 Workspace 组合约束：

- Provider 名称：`(workspace_id, name)`。
- HTTP Tool slug：`(workspace_id, slug)`。
- MCP Server slug：`(workspace_id, slug)`。
- Skill 来源摘要：`(workspace_id, source_type, source_hash)`。
- 默认模型设置：`workspace_id` 唯一，每个空间一行。
- 知识库向量集合名继续全局唯一，但名称必须包含 Workspace ID。

所有列表索引以 `workspace_id` 作为第一列，例如：

```text
(workspace_id, deleted_at, created_at DESC)
(workspace_id, enabled, updated_at DESC)
(workspace_id, user_id, status, updated_at DESC)
```

## 5. 当前项目空间上下文

### 5.1 请求结构

前端普通业务请求统一发送：

```http
X-Workspace-ID: <uuid>
Authorization: Bearer <access-token>
```

认证 Guard 先验证全局用户，再由 Workspace Guard 查询：

```text
workspace_members.workspace_id = X-Workspace-ID
workspace_members.user_id = currentUser.id
workspace_members.removed_at IS NULL
workspaces.deleted_at IS NULL
```

验证成功后向请求写入：

```ts
type CurrentWorkspace = {
  id: string;
  name: string;
  role: "OWNER" | "MANAGER" | "MEMBER";
};
```

选择 Header + 服务端实时验证，而不是切换时轮换 JWT，原因是：

- 一个页面中的当前空间切换不需要重新签发 Access Token。
- Access Token 继续只表示全局身份，空间角色变化可在下一次请求立即生效。
- Header 不构成信任边界，最终空间仍由服务端成员关系校验决定。

### 5.2 无 Header 的处理

- `/auth/*`、`/workspaces`、邀请激活和公开 Agent 接口不要求当前 Workspace。
- 业务接口缺少 Header 时返回明确的 `workspace_required` 错误。
- 只有一个项目空间的前端自动选择；多个空间使用上次选择，失效时回退到列表第一项。

### 5.3 装饰器和 Guard

新增：

- `@CurrentWorkspace()`：读取可信 Workspace 上下文。
- `@WorkspaceRoles(...)`：声明空间内角色。
- `@WorkspaceOptional()`：仅用于同时支持登录态和外部 Token 的受控入口。
- `WorkspaceGuard`：验证成员关系并填充请求上下文。
- `WorkspaceRolesGuard`：执行 OWNER/MANAGER/MEMBER 授权。

业务模块使用 `@WorkspaceRoles(...)` 声明项目角色；平台 `UserRole.ADMIN` 只用于账号与登录安全管理，不自动获得项目数据权限。

## 6. Service 与跨模块调用

Service 公开用例必须显式接收 `workspaceId`：

```ts
listAgents(workspaceId, query);
getAgent(workspaceId, agentId);
getKnowledgeBase(workspaceId, knowledgeBaseId);
listToolCallLogs(workspaceId, query);
runWorkflow({ workspaceId, ...request });
```

固定调用链：

```text
Chat(workspaceId)
  -> Agents(workspaceId)
  -> Retrieval(workspaceId)
       -> Knowledge(workspaceId)
       -> ModelProviders(workspaceId)
  -> Tools(workspaceId)
       -> HTTP Tool / MCP(workspaceId)
  -> Logs / AgentRuns(workspaceId)
```

所有跨模块绑定在写入前验证两侧 `workspaceId` 一致：

- Agent 与 ModelConfig。
- Agent 与 KnowledgeBase。
- Agent 与 Tool/MCP Tool。
- Agent 与 WorkflowVersion。
- KnowledgeBase 与 Embedding ModelConfig。
- Workflow 节点与 ModelConfig、KnowledgeBase、Tool。
- MCP Resource 与目标 KnowledgeBase。
- MCP Prompt 与目标 Skill。

禁止通过“先按 ID 查询，再假设属于当前空间”的方式访问资源。

## 7. 模块权限与隔离

| 模块                 | OWNER/MANAGER    | MEMBER                         | 隔离重点                     |
| -------------------- | ---------------- | ------------------------------ | ---------------------------- |
| Model Providers      | 完整管理         | 不显示管理入口         | API Key、默认模型按空间隔离  |
| Agents               | 完整管理         | 创建并管理本人 Agent           | 详情、发布、绑定均校验空间   |
| Knowledge            | 完整管理         | 只读查看启用知识库     | 文件、Chunk、向量均带空间    |
| Tools / MCP / Skills | 完整管理         | 创建本人 HTTP Tool、使用启用项 | Secret 与 OAuth Token 隔离   |
| Workflows            | 编辑、发布、运行 | 运行已发布应用         | 编译资源必须同空间           |
| Chat                 | 查看自己的会话   | 查看自己的会话         | 同时校验 workspaceId、userId |
| Logs / Run Trace     | 查看空间日志     | 不开放全空间列表       | 日志直接记录 workspaceId     |
| Members              | 邀请和管理       | 查看成员列表可选       | OWNER 保护和邀请归属         |

## 8. 文件、向量、缓存和异步任务

### 8.1 文件

新文件路径：

```text
storage/workspaces/<workspaceId>/documents/<documentId>/<uuid>
```

迁移期间保留旧 `storagePath` 读取兼容；新上传只写新路径。数据库使用 UUID 路径，原始文件名仅用于展示。

### 8.2 向量

pgvector 查询必须同时包含：

```text
workspace_id
knowledge_base_id
embedding_model_config_id
```

逻辑集合名称：

```text
workspace_<workspaceId>__kb_<knowledgeBaseId>
```

### 8.3 缓存和任务

- 缓存 Key 第一段必须是 `workspaceId`。
- 文档索引任务包含 `workspaceId / knowledgeBaseId / documentId / requestId`。
- 任务执行前再次校验资源归属和有效状态。
- SSE 在建立时固定 Workspace；切换空间必须主动终止旧连接。
- 日志记录 `workspaceId / requestId / userId / agentId / runId`。

## 9. 项目空间与邀请 API

```text
GET    /api/v1/workspaces
POST   /api/v1/workspaces
GET    /api/v1/workspaces/:workspaceId
PUT    /api/v1/workspaces/:workspaceId
DELETE /api/v1/workspaces/:workspaceId

GET    /api/v1/workspaces/:workspaceId/members
POST   /api/v1/workspaces/:workspaceId/invitations
DELETE /api/v1/workspaces/:workspaceId/invitations/:invitationId
PUT    /api/v1/workspaces/:workspaceId/members/:userId/role
DELETE /api/v1/workspaces/:workspaceId/members/:userId
POST   /api/v1/workspaces/:workspaceId/transfer-ownership
```

邀请规则：

1. 邀请指定目标 Workspace 和角色，只允许 `MANAGER / MEMBER`；OWNER 必须通过显式转让产生。
2. 已有 User 接受邀请时只新增或恢复 `WorkspaceMember`。
3. 新 User 接受邀请时设置密码并创建账号，再新增成员关系。
4. 同一用户加入不同项目空间互不影响。
5. 移除成员只关闭该 Workspace 的成员关系，不禁用全局 User。
6. 最后一个 OWNER 不能退出、移除或被降级。

## 10. 前端方案

### 10.1 WorkspaceProvider

新增 `WorkspaceProvider`，位于 `AuthProvider` 内部、路由页面外部，负责：

- 加载当前用户加入的项目空间。
- 选择和持久化当前 `workspaceId`。
- 暴露当前空间角色。
- 切换空间时清理 GET 去重缓存、页面缓存和运行中的 SSE。
- 普通 API 请求自动添加 `X-Workspace-ID`。

只在 `localStorage` 保存非敏感的最后选择 Workspace ID，不保存角色或成员权限；角色始终由服务端响应决定。

### 10.2 页面

- 左侧导航品牌区增加项目空间选择器。
- “成员”页面改为当前项目空间成员，不再管理平台全部用户。
- OWNER/MANAGER 显示项目级管理菜单。
- MEMBER 可以使用共享资源，并创建、管理本人创建的 Agent 和 HTTP Tool。
- 切换空间后回到当前角色可访问的默认路由。

## 11. 迁移与发布

### 11.1 数据迁移顺序

1. 备份 PostgreSQL、上传文件和环境变量。
2. 创建 Workspace、WorkspaceMember 和 WorkspaceRole。
3. 创建“默认项目空间”。
4. 最早创建的有效全局 ADMIN 成为 OWNER；其他 ADMIN 成为 Workspace MANAGER；USER 成为 MEMBER。
5. 所有业务表增加可空 `workspace_id`。
6. 根据根资源和外键链批量回填默认空间。
7. 校验每张表 `workspace_id IS NULL` 数量为 0。
8. 增加外键、组合索引和空间内唯一约束，再改为 `NOT NULL`。
9. 将全局默认模型设置迁移为默认空间设置。
10. 发布带 Workspace 过滤的后端。
11. 发布带项目空间选择器的前端。

数据库迁移和后端隔离必须在同一个维护窗口完成。启用多空间写入后不支持简单回退到旧应用，应通过备份恢复或前向修复。

### 11.2 兼容策略

- 迁移脚本只创建一个默认空间，不复制现有业务数据。
- 旧文件路径继续可读，新文件使用 Workspace 路径。
- `User.role` 暂时保留一个版本，不再用于空间内授权。
- 已发布 Agent Token 和 API Key 保持有效，通过 Agent 反查并记录 Workspace。

## 12. 测试与验收

必须使用至少两个 Workspace、三个 User 覆盖：

- Workspace A 成员无法列出、读取、更新、删除 Workspace B 的任何资源。
- 伪造 Agent、模型、知识库、文档、工具、MCP、Skill、Workflow、Run ID 均返回 404。
- 跨空间绑定被拒绝且不产生部分写入。
- 同一用户切换空间后列表、缓存、SSE、对话和日志立即切换。
- 移除成员后其下一次请求立即收到 403，旧 Access Token 不能继续使用。
- 邀请已存在和不存在的邮箱都能正确加入目标空间。
- MANAGER 不能处理 OWNER；OWNER 转让后权限立即生效。
- 外部 Agent 只能调用所属空间的模型、知识库和工具。
- 文档索引和向量检索不会写入或命中其他空间。
- 旧数据迁移后数量、关联、文件读取、向量检索和公开链接保持完整。

除 Service 单元测试外，必须增加真实 API 越权集成测试。项目空间隔离属于安全边界，不能只依赖前端菜单测试。

## 13. 实施阶段

### Phase 1：租户骨架与兼容迁移

- Prisma 模型、默认空间迁移。
- Workspace CRUD、成员列表、邀请。
- Workspace 上下文、装饰器和 Guard。
- 前端 WorkspaceProvider 和空间选择器。

### Phase 2：核心资源隔离

- Model Providers、Agents、Knowledge、Chat。
- 文件存储、Embedding、pgvector。
- 跨模块绑定校验。

### Phase 3：扩展能力隔离

- Tools、MCP、Skills、Workflows。
- Agent Runs、Tool Logs、外部访问。
- 缓存、SSE 和后台任务上下文。

### Phase 4：安全收口

- 移除业务模块对全局 `User.role` 的依赖。
- 完整越权集成测试和迁移核对脚本。
- 评估 PostgreSQL RLS 作为第二道防线，但不能替代 Service 的显式 Workspace 条件。

## 14. 完成定义

只有同时满足以下条件，才能宣布多项目空间完成：

- 所有业务根资源拥有非空 `workspace_id`。
- 所有业务 Service 查询显式包含 `workspaceId`。
- 所有跨模块绑定验证双方属于同一空间。
- 文件、向量、日志、任务和外部访问携带 Workspace。
- 前端切换空间不会复用旧空间状态。
- 两空间越权测试全部通过。
- 默认空间迁移经过数量和关联校验。

## 15. 本次落地状态

本方案已完成第一版实现：

- 已增加 Workspace、WorkspaceMember、空间邀请和两阶段数据迁移。
- 已在主要业务资源、会话、日志、Run Trace、MCP 状态及向量表写入 `workspace_id`。
- 已增加 `X-Workspace-ID` 校验、异步请求上下文和 `OWNER / MANAGER / MEMBER` 授权。
- 已把模型、Agent、知识库、Workflow、Skill、工具、MCP、Chat、日志和 Run Trace 查询收敛到当前空间。
- 已将平台账号管理与项目成员管理拆分；平台管理员可独立管理账号，项目 OWNER 管理成员。
- 前端已增加空间选择、切换后页面重建、成员管理、邀请、角色调整和所有权转让。
- MEMBER 可以使用共享资源，并创建、管理本人创建的 Agent 和 HTTP Tool；OWNER/MANAGER 可管理空间内全部业务资源。

部署前需要执行 Prisma migration。生产数据库迁移前必须先完成数据库和上传文件备份；本次实现没有自动修改当前数据库。
