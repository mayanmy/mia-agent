# Mia 多团队 Workspace 技术方案

## 1. 设计结论

Mia 多团队采用共享数据库、行级 Workspace 隔离的模块化单体方案：

```text
User（全局身份）
  └─ WorkspaceMember（团队内角色）
       └─ Workspace（租户边界）
            └─ 业务资源（workspace_id）
```

不按 User 隔离模型供应商和 Agent。团队资源由 Workspace 持有，成员根据 WorkspaceMember 角色获得访问权。这与团队协作型 Agent 平台的资源模型一致，也能避免为每名成员复制模型配置和知识库。

## 2. 数据模型

### 2.1 新增表

```prisma
enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
}

model Workspace {
  id          String            @id @default(uuid()) @db.Uuid
  name        String
  description String            @default("")
  createdAt   DateTime          @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime          @updatedAt @db.Timestamptz(6)
  deletedAt   DateTime?         @db.Timestamptz(6)
  members     WorkspaceMember[]

  @@index([createdAt(sort: Desc)])
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

User 保持全局邮箱唯一，不再把 `User.role` 作为工作台授权依据。迁移完成并稳定后移除该列，或只保留为平台运维角色，避免与团队角色混淆。

### 2.2 资源表归属

以下根资源增加非空 `workspace_id`：

| 模块            | 根资源                                                       |
| --------------- | ------------------------------------------------------------ |
| model_providers | `model_providers`、`model_configs`、`default_model_settings` |
| agents          | `agents`、发布配置、绑定关系                                 |
| knowledge       | `knowledge_bases`、文档、chunk、embedding                    |
| logs            | `tool_call_logs`、后续对话/检索日志                          |
| auth            | `user_invitations`                                           |

子表虽然可经外键追溯 Workspace，仍建议冗余 `workspace_id` 到高频检索、后台任务、日志和向量表：这样可避免跨表条件遗漏，提升索引效率，并为未来按 Workspace 分库或迁移 Qdrant 留出边界。

关键约束：

- `default_model_settings` 从全局固定主键改为每 Workspace 一行，`workspace_id` 唯一。
- `user_invitations` 的邮箱唯一约束改为 `(workspace_id, email)`。
- 所有资源列表索引优先以 `workspace_id` 开头，例如 `(workspace_id, deleted_at, created_at DESC)`。
- Agent 与 ModelConfig、KnowledgeBase 的关联写入前必须验证双方同属一个 Workspace。

## 3. 请求上下文与鉴权

### 3.1 CurrentWorkspace

JWT Guard 在验证 User 之后，必须根据当前 Workspace 解析有效成员关系，并向请求写入：

```ts
type CurrentWorkspace = {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};
```

Controller 使用 `@CurrentWorkspace()` 获取上下文，Service 显式接收 `workspaceId`。禁止通过全局变量、前端传入的任意 ID 或 ORM 默认查询推断租户。

```ts
listAgents(workspaceId: string, query: AgentQueryDto): Promise<PageResult<AgentListItem>>
```

### 3.2 当前团队选择

推荐将 `workspaceId` 写入 Access Token，并在 Refresh Session 中保存 `activeWorkspaceId`。切换团队调用：

```text
POST /api/v1/workspaces/:id/switch
```

服务端确认成员关系后轮换 Access Token，新的 JWT 携带新的 Workspace。每次业务请求仍需查询或缓存成员关系，以便成员被移除后立即失效。

不要仅依赖前端 `X-Workspace-ID`：该 Header 可以作为切换前的选择输入，但必须由服务端验证成员关系，不能直接作为数据查询条件。

### 3.3 授权策略

新增 `WorkspaceRoles` Guard，读取 `CurrentWorkspace.role` 判断角色。资源查询一律先按 `workspace_id` 过滤；资源不存在或不属于当前 Workspace 时统一返回 404，避免暴露其他团队资源是否存在。

## 4. 服务层改造

所有业务 Service 的公开方法显式接收 Workspace 上下文或 Workspace ID：

```text
modelProvidersService.listProviders(workspaceId, query)
agentsService.getAgent(workspaceId, agentId)
knowledgeService.getKnowledgeBase(workspaceId, knowledgeBaseId)
logsService.listToolCallLogs(workspaceId, query)
```

跨模块 DTO 增加 `workspaceId`。Chat、Retrieval、Jobs、Logs 调用链必须原样透传它：

```text
chat
  -> agents(workspaceId)
  -> retrieval(workspaceId)
  -> model_providers(workspaceId)
  -> tools(workspaceId)
  -> logs(workspaceId)
```

后台索引任务 payload 至少包含 `workspaceId`、`knowledgeBaseId`、`documentId`、`requestId`。任务执行前重新确认资源归属和有效状态，避免成员切换或删除资源后错误写入。

## 5. 存储、向量、缓存与日志

### 5.1 文件存储

物理文件保持 UUID 命名，按 Workspace 分目录：

```text
volumes/app/storage/workspaces/<workspaceId>/documents/<documentId>/<uuid>
```

数据库保存正常中文展示名，磁盘路径不使用用户文件名。

### 5.2 向量 namespace

当前 pgvector 和未来 Qdrant 都使用知识库级 namespace，并在前缀包含 Workspace：

```text
workspace_<workspaceId>__kb_<knowledgeBaseId>
```

检索 SQL 必须带 `workspace_id` 与 `knowledge_base_id` 条件。迁移 Qdrant 后，每个 Dataset 可继续对应独立 Collection，Collection 名包含 Workspace ID。

### 5.3 缓存与日志

- 缓存 key 必须以 `workspaceId` 作为第一层前缀。
- `request_id`、Agent ID、User ID、Workspace ID 同时写入日志。
- `tool_call_logs` 增加 `workspace_id`，列表默认按当前 Workspace 查询。
- 任何后台任务、错误日志、模型调用日志不得只依赖 Agent ID 推断 Workspace。

## 6. 外部 Agent 与 Widget

发布 Token 继续全局唯一，外部接口通过 Token 解析 Agent 后获得其 `workspaceId`。外部访客的 `visitor`/`user` 标识仅用于会话隔离，不具备 Workspace 成员身份。

外部 API Key 需要绑定 Workspace 和 Agent；撤销 Workspace 成员资格不应自动使外部已发布 Agent 失效，除非 OWNER/ADMIN 明确下线 Agent 或撤销 API Key。

## 7. 单团队数据迁移

### 7.1 迁移步骤

1. 备份 PostgreSQL 数据库与 `volumes/app/storage`。
2. 创建 `workspaces`、`workspace_members`，生成一个“默认团队”。
3. 将现有 ADMIN 建为默认团队 OWNER，其余 User 建为 MEMBER。
4. 向现有资源表添加可空 `workspace_id`，并批量回填默认团队 ID。
5. 校验无空值后改为 `NOT NULL`，创建外键、组合索引和新唯一约束。
6. 将默认模型设置从全局行迁移为默认团队行。
7. 迁移文件路径、向量 namespace、缓存 key；对仍在索引的任务暂停并重新调度。
8. 发布按 Workspace 过滤的后端，再发布 Workspace 切换前端。

### 7.2 回滚策略

- 数据迁移前必须完成逻辑备份和文件备份。
- 迁移脚本分阶段执行并记录校验数量；未验证前不删除旧字段或旧路径。
- 在一个发布窗口内保留兼容读取：若 `workspace_id` 为空，仅允许读取默认团队资源。
- 一旦启用多团队写入，不允许通过简单数据库回滚回单团队；应使用备份恢复或前向修复。

## 8. 安全与测试

必须覆盖以下测试：

- Workspace A 成员无法读取、修改、删除 Workspace B 任意资源。
- 伪造 Agent ID、KnowledgeBase ID、ModelConfig ID、Document ID 均不能跨团队访问。
- 跨团队绑定 Agent/模型/知识库被拒绝。
- 成员被移除后，旧 Access Token 下一次请求即被拒绝。
- 切换 Workspace 后缓存、SSE、上传、检索和日志不会继续使用旧 Workspace。
- 外部已发布 Agent 只能访问自身所属 Workspace 的模型、工具和知识库。
- 数据迁移后所有旧资源都只归属默认团队，数量、文件与向量检索结果一致。

可在应用层过滤基础上，后续评估 PostgreSQL Row Level Security 作为第二道防线；一期不应依赖 RLS 替代 Service 层的明确 Workspace 条件。

## 9. 实施阶段

### Phase 1：基础租户边界

- Workspace、WorkspaceMember、CurrentWorkspace、成员关系 Guard。
- 默认团队数据迁移。
- 模型、Agent、知识库、日志的 `workspace_id` 过滤。

### Phase 2：团队体验

- Workspace 切换器、团队设置、成员邀请和成员角色管理。
- Workspace 级默认模型设置、工具/HTTP allowlist 配置。

### Phase 3：外部访问与运维

- Workspace 级 API Key、配额、限流、审计和备份导出。
- 向量存储按 Workspace namespace 或独立 Collection 运维。
- 可选的 PostgreSQL RLS、跨团队安全审计和管理员支持工具。
