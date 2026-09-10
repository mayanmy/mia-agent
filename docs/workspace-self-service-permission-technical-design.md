# Mia 用户自助项目空间与资源归属技术方案

## 1. 方案状态

- 状态：已按本方案实施，数据库迁移尚待部署环境执行。
- 目标：每个有效账号都能创建项目空间，并在自己创建的空间内管理成员和业务资源；平台管理员只负责账号与登录安全，不因平台角色自动获得项目数据权限。
- 范围：项目空间、平台账号、Agent、HTTP Tool、模型配置只读能力和相关前端权限展示。
- 非目标：自定义 RBAC、资源级授权配置器、跨空间共享、计费和空间配额管理后台。

## 2. 设计结论

当前 `User.role`、`WorkspaceMember.role` 和资源管理权限存在概念重叠。推荐改为两层授权，并明确资源创建者：

```text
平台身份
  ADMIN：管理账号、密码、禁用状态和登录会话
  USER：普通有效账号

项目空间身份
  OWNER：空间创建者，管理空间、成员和空间内全部资源
  MANAGER：被 OWNER 委派，管理空间内全部业务资源
  MEMBER：使用共享资源，并创建、管理自己创建的 Agent 和 Tool

资源归属
  workspace_id：决定资源属于哪个项目空间
  created_by_user_id：决定普通成员是否可以修改该资源
```

核心原则：

1. 平台 `ADMIN` 只管理账号，不自动获得任意项目空间的访问权。
2. 所有有效账号都可以创建项目空间；创建必须在事务内同时写入唯一有效 `OWNER` 成员关系。
3. 用户只有加入项目空间后才能查看该空间数据。
4. `MEMBER` 可以创建 Agent 和 HTTP Tool，但只能修改、删除和发布自己创建的资源。
5. `OWNER / MANAGER` 可以管理空间内全部 Agent 和 Tool。
6. 跨空间访问始终返回 404；同空间内已知资源但无修改权限返回 403。
7. 前端只负责隐藏或禁用入口，最终权限必须由后端重新校验。

## 3. 角色命名与职责

### 3.1 平台角色

| 能力                     | ADMIN | USER |
| ------------------------ | ----- | ---- |
| 创建项目空间             | 是    | 是   |
| 使用已加入的项目空间     | 是    | 是   |
| 创建自己的 Agent、Tool   | 是    | 是   |
| 查看平台账号列表         | 是    | 否   |
| 创建、禁用平台账号       | 是    | 否   |
| 重置密码、撤销登录会话   | 是    | 否   |
| 自动访问未加入的项目空间 | 否    | 否   |
| 自动管理所有项目业务资源 | 否    | 否   |

平台账号接口使用 `User.role = ADMIN` 鉴权，不要求当前 `X-Workspace-ID`，也不应挂在项目空间角色路由下面。

### 3.2 项目空间角色

现有 `WorkspaceRole.ADMIN` 已改名为 `MANAGER`，避免与平台管理员混淆。界面术语固定为“所有者 / 项目管理员 / 成员”。

| 能力                                  | OWNER | MANAGER | MEMBER |
| ------------------------------------- | ----- | ------- | ------ |
| 查看和使用空间内已启用资源            | 是    | 是      | 是     |
| 创建 Agent、HTTP Tool                 | 是    | 是      | 是     |
| 修改、删除自己创建的 Agent、HTTP Tool | 是    | 是      | 是     |
| 管理其他成员创建的业务资源            | 是    | 是      | 否     |
| 修改项目空间名称和描述                | 是    | 否      | 否     |
| 邀请、移除成员                        | 是    | 否      | 否     |
| 任命项目管理员                        | 是    | 否      | 否     |
| 转让所有权、删除项目空间              | 是    | 否      | 否     |

## 4. 页面与导航边界

### 4.1 项目空间选择器

所有登录用户都能在空间选择器底部看到：

```text
+ 新建项目空间
管理当前项目空间（仅 OWNER）
```

未加入任何空间时仍展示账号菜单、退出登录和“创建项目空间”。创建成功后自动切换到新空间。

### 4.2 平台账号管理

- 路由：`/admin/users`。
- 导航名称：`账号管理`。
- 鉴权：独立的 `RequirePlatformRole([ADMIN])`，不依赖当前空间角色。
- 即使平台管理员尚未加入任何空间，也能进入该页面。
- 功能：搜索账号、新增账号、启停账号、重置密码、撤销会话。
- 平台账号创建后不会自动加入任意项目空间；由空间 OWNER 发出邀请。

### 4.3 项目空间成员管理

- 路由：`/users`（后续可以兼容迁移到 `/workspace/settings/members`）。
- 仅当前空间 `OWNER` 可以操作。
- 功能：邀请成员、移除成员、任命项目管理员、转让所有权。
- 不提供重置密码。密码属于平台账号安全能力，不属于某个项目空间。

### 4.4 Agent 与 Tool 页面

- 所有 `OWNER / MANAGER / MEMBER` 都能看到 Agent 和 Tool 导航。
- 所有成员都显示“新建 Agent”“新建工具”。
- 列表项由服务端返回 `canEdit / canDelete / canPublish`，前端不自行推导所有权。
- `MEMBER` 可以看到并使用空间内启用的共享资源；自己的草稿或停用资源仍可见。
- 对其他成员资源，`MEMBER` 只显示查看或使用入口，不显示编辑、删除和发布入口。

## 5. 数据模型调整

### 5.1 Agent 增加创建者

当前 `agents` 只有 `workspace_id`，无法判断普通成员是否在修改自己的 Agent，必须新增：

```prisma
model Agent {
  // existing fields...
  workspaceId     String @map("workspace_id") @db.Uuid
  createdByUserId String @map("created_by_user_id") @db.Uuid
  createdBy       User   @relation("AgentCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)

  @@index([workspaceId, createdByUserId, deletedAt, createdAt(sort: Desc)])
}
```

`createdByUserId` 只能从认证上下文写入，创建 DTO 不允许客户端提交。

### 5.2 HTTP Tool

`http_tools` 已有 `workspace_id` 和 `created_by_user_id`，无需新增字段。需要补充组合索引：

```prisma
@@index([workspaceId, createdByUserId, deletedAt, createdAt(sort: Desc)])
```

工具密钥继续只保存加密值。普通成员只能更新自己工具关联的 Secret，不允许读取任何明文密钥。

### 5.3 WorkspaceRole 改名

目标枚举：

```prisma
enum WorkspaceRole {
  OWNER
  MANAGER
  MEMBER
}
```

如果执行改名，PostgreSQL 迁移使用枚举值重命名，把现有 `ADMIN` 原样迁移为 `MANAGER`，不改变成员权限，不删除成员数据。

## 6. 后端授权设计

### 6.1 通用资源授权函数

在各资源所属模块内部实现授权，不新增全局业务 Service：

```ts
type ResourceActor = {
  userId: string;
  workspaceId: string;
  workspaceRole: "OWNER" | "MANAGER" | "MEMBER";
};

function canManageResource(actor: ResourceActor, createdByUserId: string): boolean {
  return (
    actor.workspaceRole === "OWNER" ||
    actor.workspaceRole === "MANAGER" ||
    actor.userId === createdByUserId
  );
}
```

Controller 只接收请求、获取 `CurrentUser / CurrentWorkspace` 并调用 Service。资源归属查询和授权由所属模块 Service 完成。

### 6.2 Agent API

| API                    | 允许角色     | Service 附加校验            |
| ---------------------- | ------------ | --------------------------- |
| `GET /agents`          | 所有空间成员 | MEMBER：启用资源或自己创建  |
| `POST /agents`         | 所有空间成员 | 写入当前 user 为创建者      |
| `GET /agents/:id`      | 所有空间成员 | 同空间；草稿仅创建者/管理者 |
| `PUT /agents/:id`      | 所有空间成员 | 创建者或 OWNER/MANAGER      |
| `DELETE /agents/:id`   | 所有空间成员 | 创建者或 OWNER/MANAGER      |
| 发布、绑定工具和知识库 | 所有空间成员 | 创建者或 OWNER/MANAGER      |

Agent 表单还需要读取可用 Chat Model。模型供应商的 Secret 和管理接口仍只开放给 `OWNER / MANAGER`，但所有成员可以访问单独的安全只读模型选项接口：

```text
GET /api/v1/model-configs/options?type=CHAT&enabled=true
```

响应只包含 `id / modelName / providerName / modelType`，不返回 Base URL、API Key 或其他敏感配置。

### 6.3 HTTP Tool API

| API                         | 允许角色     | Service 附加校验        |
| --------------------------- | ------------ | ----------------------- |
| `GET /tools/http`           | 所有空间成员 | MEMBER 只返回自己创建项 |
| `POST /tools/http`          | 所有空间成员 | 写入当前 user 为创建者  |
| `GET /tools/http/:id`       | 所有空间成员 | 创建者或 OWNER/MANAGER  |
| `PUT /tools/http/:id`       | 所有空间成员 | 创建者或 OWNER/MANAGER  |
| `DELETE /tools/http/:id`    | 所有空间成员 | 创建者或 OWNER/MANAGER  |
| `POST /tools/http/:id/test` | 所有空间成员 | 创建者或 OWNER/MANAGER  |

安全约束：

- `MEMBER` 创建的工具默认 `allowPrivateNetwork = false`，且不能自行开启。
- 只有 `OWNER / MANAGER` 可以允许访问私网地址。
- 所有网络策略、Host allowlist、超时、响应大小和凭据脱敏规则继续生效。
- Agent 运行时可以调用空间内已启用工具，但不会向用户返回工具 Secret。

### 6.4 项目空间 API

```text
POST /api/v1/workspaces
```

- 所有未禁用账号可调用。
- 在单个数据库事务内创建 Workspace 和 OWNER 成员关系。
- 不接受客户端提交 ownerUserId。
- 建议初始限制每个账号最多创建 20 个有效空间，避免误操作或滥用；后续可配置。

空间更新、成员管理、转让和删除继续由 `OWNER` 控制。平台 `ADMIN` 若未加入该空间也不能调用这些接口。

## 7. 查询与返回 DTO

Agent 和 HTTP Tool 列表 DTO 增加稳定的业务字段：

```ts
type ResourcePermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canPublish?: boolean;
};

type ResourceCreatorSummary = {
  id: string;
  displayName: string;
};
```

列表返回 `creator` 和 `permissions`。前端使用服务端权限字段渲染按钮，避免空间切换、所有权转让或成员角色变化后出现错误入口。

禁止返回 ORM User 对象、邮箱以外的账号信息、密码哈希或凭据字段。

## 8. 数据迁移方案

### 8.1 Agent 创建者回填

迁移分三步执行：

1. 为 `agents` 增加可空 `created_by_user_id`。
2. 按 `workspace_id` 回填为该空间的 `created_by_id`；如果历史空间创建者异常，则回填当前有效 OWNER。
3. 校验无空值后设置 `NOT NULL`、外键和组合索引。

迁移发现某个 Agent 找不到有效空间或创建者时必须失败，不允许静默删除 Agent。

### 8.2 角色迁移

- `WorkspaceRole.ADMIN` 改为 `MANAGER` 时只重命名枚举值。
- 已有 OWNER、MEMBER 和成员关系不变。
- `User.role` 继续保留 `ADMIN / USER`，只用于平台账号管理。

### 8.3 回滚边界

- 上线前使用 `pg_dump -Fc` 备份数据库。
- 先上线兼容读取新旧角色值的后端，再执行枚举改名，最后上线前端术语。
- Agent 创建者字段在完成回填前保持可空；应用稳定后再收紧非空。

## 9. 实施顺序

### 第一阶段：权限边界与页面入口

1. 新增独立平台账号路由和 `RequirePlatformRole`。
2. 将项目成员管理拆到空间设置，仅 OWNER 可操作。
3. 在空间选择器增加长期可见的“新建项目空间”。
4. 统一“平台管理员 / 项目管理员”术语。

### 第二阶段：资源创建者

1. 增加 Agent 创建者字段、关系、索引和数据迁移。
2. Agent/Tool Service 增加创建者或 OWNER/MANAGER 授权。
3. DTO 返回 creator 与 permissions。
4. 补充跨空间和越权测试。

### 第三阶段：成员自助创建

1. Agent 创建、编辑、发布和绑定接口开放给 MEMBER。
2. 新增安全的模型选项只读接口。
3. HTTP Tool 管理接口开放给 MEMBER，并限制私网配置。
4. 前端向所有成员展示 Agent、Tool 导航和创建入口。

### 第四阶段：角色改名与清理

1. `WorkspaceRole.ADMIN` 迁移为 `MANAGER`。
2. 清理前后端残留的“全局管理员可管理业务资源”判断。
3. 更新技术文档、菜单指南和运维检查清单。

## 10. 验收标准

至少覆盖以下场景：

1. 普通 USER 可以创建空间，并立即成为唯一 OWNER。
2. 普通 USER 可以在自己创建的空间邀请成员、修改空间资料和转让所有权。
3. MEMBER 可以创建 Agent 和 HTTP Tool，并编辑、删除自己的资源。
4. MEMBER 可以使用同空间其他成员发布或启用的资源，但不能修改对方资源。
5. OWNER/MANAGER 可以管理空间内所有 Agent 和 Tool。
6. 平台 ADMIN 未加入空间时不能读取该空间的 Agent、Tool、日志和成员。
7. 平台 ADMIN 可以在无当前空间时创建账号、重置密码和撤销会话。
8. 切换空间后列表、请求去重缓存和权限按钮不会复用上一个空间状态。
9. 所有跨空间资源 ID 请求返回 404，不泄露资源存在性。
10. MEMBER 不能创建允许私网访问的 HTTP Tool，也不能读取任何工具凭据。

## 11. 暂不实施的能力

- Agent 或 Tool 私有可见性开关。
- 单资源协作者列表。
- 自定义角色和权限模板。
- 平台管理员强制接管项目空间。
- 跨空间复制或共享 Agent、Tool。

第一版先保持“空间内可见、创建者可改、项目管理者可管”的简单规则。

## 12. 实施结果

- 已完成 `WorkspaceRole.ADMIN -> MANAGER` 数据库枚举迁移脚本。
- 已为 Agent 增加创建者字段并按项目空间创建者安全回填；HTTP Tool 补充创建者组合索引。
- 已实现 OWNER/MANAGER 管理全部资源、MEMBER 仅管理本人 Agent/HTTP Tool 的服务端授权。
- 已提供安全模型选项接口，成员无需读取供应商连接信息即可创建 Agent。
- 已拆分“账号管理”和“空间成员”，并在空间选择器、空空间页提供创建空间和退出登录入口。
- 已通过 Prisma Schema 校验、前后端 TypeScript 检查和后端权限测试；部署前仍需先备份并执行迁移。
