# Auth / User 登录权限技术方案

> 文档状态：认证基础已实施。JWT、Refresh Session 与撤销机制仍是当前方案；业务资源鉴权已经迁移到 Workspace `OWNER / MANAGER / MEMBER`，全局 Admin/User 不再作为空间资源的最终授权依据。

## 1. 设计决策

Mia v1 采用以下组合：

```text
邮箱 + 密码
  -> 短期 JWT Access Token（15 分钟，前端内存）
  -> 长期随机 Refresh Token（30 天，HttpOnly Cookie）
  -> auth_sessions 中保存 Refresh Token 的哈希，可服务端撤销
```

选择原因：

- JWT 适合现有 REST 和 SSE 接口，Guard 校验不需要每次查会话表。
- Refresh Session 保存在数据库，禁用用户、重置密码和退出全部设备可以即时撤销后续续期能力。
- 长期凭证不进入 JavaScript 可读存储，显著降低 XSS 后被长期盗用的风险。
- 本地部署的模块化单体在初始容量下不需要 Redis、OAuth Server 或分布式 Session；规模扩大后应根据会话量、节点数和可用性目标重新评估。

不采用“仅将长期 JWT 放 localStorage”的原因：无法可靠撤销、XSS 风险高，且不能支持设备级退出。

## 2. 模块边界与目录

```text
backend/src/
  core/
    auth/
      current-user.decorator.ts
      jwt-auth.guard.ts
      roles.decorator.ts
      roles.guard.ts
      auth.types.ts
  modules/
    users/
      users.module.ts
      users.controller.ts
      users.service.ts
      dto/users.dto.ts
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      password.service.ts
      token.service.ts
      dto/auth.dto.ts
  scripts/
    bootstrap-admin.ts

frontend/src/
  features/auth/
    LoginPage.tsx
    auth.api.ts
    auth.types.ts
    AuthProvider.tsx
    RequireAuth.tsx
    RequireRole.tsx
    auth.less
  features/users/
    UsersPage.tsx
    users.api.ts
    users.types.ts
    users.less
```

职责：

- `users`：用户资料、角色、启用/禁用和管理员用户管理用例；不签发 Token。
- `auth`：密码验证、Token 签发、刷新、退出、Session 撤销和安全审计；不直接承载用户管理页面业务。
- `core/auth`：Controller 可复用的 Guard / Decorator，仅解析身份和角色，不查询业务表。
- `chat`：通过 `CurrentUser` 接收用户身份，写日志并按权限调用 Agent；不自行解析 Token。

依赖方向：

```text
core
users -> prisma, core
auth -> users, prisma, core
chat -> auth(Guard), agents, retrieval, model_providers, tools, logs
其他内部 controller -> auth(Guard / Roles)
```

`auth` 可调用 `users.service` 查找用户；`users` 不依赖 `auth`。Session 表归 `auth` 模块，User 表归 `users` 模块。

## 3. 数据模型

### 3.1 Prisma 模型

```prisma
enum UserRole {
  ADMIN
  USER

  @@map("user_role")
}

model User {
  id                   String        @id @default(uuid()) @db.Uuid
  email                String        @unique(map: "uq_users_email")
  displayName          String        @map("display_name")
  passwordHash         String        @map("password_hash")
  role                 UserRole      @default(USER)
  lastLoginAt          DateTime?     @map("last_login_at") @db.Timestamptz(6)
  disabledAt           DateTime?     @map("disabled_at") @db.Timestamptz(6)
  passwordChangedAt    DateTime      @default(now()) @map("password_changed_at") @db.Timestamptz(6)
  createdAt            DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)
  authSessions         AuthSession[]

  @@index([role, disabledAt], map: "idx_users_role_disabled_at")
  @@index([createdAt(sort: Desc)], map: "idx_users_created_at")
  @@map("users")
}

model AuthSession {
  id                String    @id @default(uuid()) @db.Uuid
  userId            String    @map("user_id") @db.Uuid
  refreshTokenHash  String    @unique(map: "uq_auth_sessions_refresh_token_hash") @map("refresh_token_hash")
  expiresAt         DateTime  @map("expires_at") @db.Timestamptz(6)
  revokedAt         DateTime? @map("revoked_at") @db.Timestamptz(6)
  ipAddress         String?   @map("ip_address")
  userAgent         String?   @map("user_agent") @db.Text
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt(sort: Desc)], map: "idx_auth_sessions_user_id_expires_at")
  @@index([expiresAt], map: "idx_auth_sessions_expires_at")
  @@map("auth_sessions")
}
```

邮箱写入前必须 `trim().toLowerCase()`。v1 使用普通唯一索引而非 `citext`，避免引入 PostgreSQL 扩展迁移依赖；规范化由唯一入口 `normalizeEmail()` 保证。

### 3.2 现有表的演进

本次首个迁移只新增 `users` 与 `auth_sessions`，不强制给所有已有业务表补 `created_by`，避免认证上线与历史数据回填耦合。

- 已有 `tool_call_logs.user_id` 继续写当前用户 ID。
- Chat / RAG 后续新增会话日志时必须带 `user_id`。
- v1.1 再给 Agent、KnowledgeBase、Document 等表补创建人和审计事件，不阻塞登录闭环。

## 4. API 设计

所有响应复用现有 `{ code, message, data }` 包装；下列路径均自动加 `/api/v1` 前缀。

| 方法    | 路径                         | 鉴权                | 说明                                                     |
| ------- | ---------------------------- | ------------------- | -------------------------------------------------------- |
| `POST`  | `/auth/login`                | 匿名                | 校验邮箱密码，返回 Access Token，并设置 Refresh Cookie。 |
| `POST`  | `/auth/refresh`              | Refresh Cookie      | 轮换 Session Token，返回新的 Access Token。              |
| `POST`  | `/auth/logout`               | Refresh Cookie 可选 | 撤销当前 Session，清 Cookie；重复调用幂等成功。          |
| `POST`  | `/auth/logout-all`           | 已登录              | 撤销当前用户所有 Session。                               |
| `GET`   | `/auth/me`                   | 已登录              | 返回当前用户公开资料。                                   |
| `GET`   | `/users`                     | Admin               | 分页查询成员。                                           |
| `POST`  | `/users`                     | Admin               | 创建成员并要求设置初始密码。                             |
| `PATCH` | `/users/:id`                 | Admin               | 修改展示名、角色、启用状态。                             |
| `POST`  | `/users/:id/reset-password`  | Admin               | 重置密码并撤销该用户全部 Session。                       |
| `POST`  | `/users/:id/revoke-sessions` | Admin               | 撤销目标用户全部 Session。                               |

DTO 摘要：

```ts
type LoginRequest = { email: string; password: string };
type AuthResponse = {
  accessToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; displayName: string; role: "ADMIN" | "USER" };
};

type CurrentUser = AuthResponse["user"];
type CreateUserRequest = {
  email: string;
  displayName: string;
  password: string;
  role: "ADMIN" | "USER";
};
```

`AuthResponse` 绝不返回 `passwordHash`、Refresh Token、Session ID 或 IP 信息。

## 5. Token 与 Cookie 细节

### 5.1 Access Token

JWT payload：

```json
{
  "sub": "user uuid",
  "role": "ADMIN",
  "email": "admin@example.com",
  "iat": 0,
  "exp": 0
}
```

- 算法固定 `HS256`，密钥来自 `MIA_AUTH_JWT_SECRET`；生产环境不得使用示例默认值。
- 有效期默认 15 分钟，配置项 `MIA_AUTH_ACCESS_TOKEN_TTL_SECONDS`。
- 请求头：`Authorization: Bearer <accessToken>`。
- Guard 每次验证签名和过期时间；随后通过 `users.service` 确认用户未禁用，避免被禁用用户在 Token 过期前继续操作。

### 5.2 Refresh Token 与轮换

- 使用 `crypto.randomBytes(48)` 生成不透明随机 Token。
- Cookie 名称：`mia_refresh_token`。
- Cookie：`HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000`；生产环境加 `Secure`。
- 数据库保存 `sha256(refreshToken)`，每次 `/auth/refresh` 成功后撤销旧 Session 并新建 Session，降低 Token 重放窗口。
- 已撤销、过期、找不到、用户禁用的 Session 都返回 401，并清理 Cookie。

开发环境 Vite 通过 `/api` Proxy 访问后端，Cookie 同源工作。若使用 `VITE_API_BASE_URL` 跨域访问，前端的普通请求和 SSE 请求都必须设置 `credentials: "include"`，后端 CORS 保持 `credentials: true` 且 Origins 不得使用 `*`。

## 6. Guard、Decorator 与路由接入

### 6.1 全局默认拒绝

认证上线后使用“默认需要登录、显式公开”的模式：

1. 全局注册 `JwtAuthGuard`。
2. `@Public()` 标记健康检查、登录、刷新、退出和公开分享 Agent 路径。
3. `@Roles(UserRole.ADMIN)` 仅限制成员管理接口。
4. 模型、知识库、工具、日志、Agent 和 Chat 接口统一使用 `@Roles(UserRole.ADMIN, UserRole.USER)`，支持团队共同维护。

这样新增 Controller 时不会因为忘记写 Guard 而意外公开。

### 6.2 Controller 使用形态

```ts
@Get("me")
getCurrentUser(@CurrentUser() user: CurrentUserDto): CurrentUserDto {
  return user;
}

@Post("completions")
streamChat(
  @CurrentUser() user: CurrentUserDto,
  @Body() payload: ChatCompletionRequest
) {
  return this.chatService.createCompletion(user, payload);
}
```

`CurrentUserDto` 为稳定业务 DTO，不向下传 `Request` 或 JWT 原始对象。Chat、Tools、Logs 通过显式 `user.id` 记录调用来源。

### 6.3 SSE 特别处理

SSE 建连前由 Guard 完成认证。`chat.service` 接收当前用户并写入一次请求上下文；连接存在期间不重复解析 Token。用户在流式过程中被禁用时，v1 通过定时心跳检查或下一次请求阻断；v1.1 增加 Session / User 变更通知，主动中断相关 SSE。

## 7. 前端设计

### 7.1 AuthProvider 状态

```text
初始化
  -> 调用 /auth/refresh
  -> 成功：保存内存 Access Token，调用 /auth/me，进入 authenticated
  -> 失败：进入 anonymous

Access Token 距离到期不足 60 秒
  -> AuthProvider 主动调用 /auth/refresh
  -> 刷新成功：更新内存 Token 和下一次续期定时器
  -> 刷新失败：清空 AuthProvider，跳转 /login

浏览器窗口重新获得焦点或页面重新可见
  -> 检查 Token 剩余有效期
  -> 不足 60 秒时复用单飞刷新

任意 API 401
  -> 单飞调用 /auth/refresh
  -> 成功：重放原请求一次
  -> 再次失败：清空 AuthProvider，跳转 /login
```

“单飞刷新”保证多个并发请求同时 401 时只发送一次 refresh，避免 Session 轮换互相作废。

`shared/api/client.ts` 集中注入 Authorization Header、建连前预刷新和 401 重试。`streamChatCompletion` 复用 `fetchWithAuth`，因此 SSE 建连前也会预留至少 60 秒 Token 有效期，避免长连接刚建立即因令牌到期失败。

### 7.2 路由与菜单

- `RequireAuth` 包裹内部壳层。
- `/login` 仅匿名可访问；已登录用户重定向默认 Agent 页面。
- `RequireRole` 保护 Admin 页面路由；即使用户手输 URL 也显示 403 页面。
- App 根据 `currentUser.role` 生成导航，成员仅不显示“成员管理”。
- 顶部或侧栏底部显示当前展示名、角色和退出菜单。

## 8. 配置、部署与初始化

新增环境变量：

```dotenv
MIA_AUTH_JWT_SECRET=replace-with-a-long-random-secret
MIA_AUTH_ACCESS_TOKEN_TTL_SECONDS=900
MIA_AUTH_REFRESH_TOKEN_TTL_DAYS=30
MIA_AUTH_COOKIE_SECURE=false
```

`MIA_AUTH_COOKIE_SECURE` 在生产 HTTPS 环境必须为 `true`。启动时需要校验：生产环境密钥不可为空、不可使用示例值；否则拒绝启动。

首位管理员使用单独脚本创建，例如：

```bash
node dist/scripts/bootstrap-admin.js --email admin@example.com --name "Mia 管理员"
```

脚本从安全输入读取密码，不允许在命令参数、Shell 历史、日志或 git 中出现明文密码。脚本必须检查是否已存在可用 Admin，避免误创建多个初始管理员。

## 9. 方法注释规范

本需求后续新增或改造的方法必须写中文 JSDoc 注释，说明职责、关键安全约束和失败语义。尤其不能省略下列方法的注释：

- `AuthService.login`、`refresh`、`logout`、`logoutAll`。
- `TokenService.signAccessToken`、`createRefreshToken`、`hashRefreshToken`。
- `PasswordService.hashPassword`、`verifyPassword`、`validatePasswordStrength`。
- `UsersService.createUser`、`updateUser`、`disableUser`、`resetPassword`。
- `JwtAuthGuard.canActivate`、`RolesGuard.canActivate`。
- 前端的登录恢复、401 单飞刷新、退出和路由守卫方法。

示例：

```ts
/**
 * 轮换当前设备的 Refresh Session。
 *
 * 旧 Token 一旦成功使用便立即撤销，避免被截获后长期重复换取 Access Token。
 * 无效或已撤销的 Token 与不存在的用户统一返回未登录，不暴露会话存在状态。
 */
async refresh(refreshToken: string, context: RequestContext): Promise<AuthResponse> {
  // ...
}
```

不写“给 token 赋值”这类重复代码含义的注释；注释应聚焦为什么需要轮换、为何统一错误、以及安全边界。

## 10. 实施步骤与提交拆分

### 第 1 步：数据与基础配置

- 新增 `UserRole`、`User`、`AuthSession` Prisma 模型和迁移。
- 扩展 `core/config.ts` 的认证配置校验。
- 新增密码、Token 依赖。
- 提交：`feat: 新增用户和认证数据模型`。

### 第 2 步：Users / Auth 后端主路径

- 实现 DTO、`users.service`、`auth.service`、Controller。
- 新增初始化管理员脚本。
- 覆盖登录、刷新、退出、禁用、重置密码测试。
- 提交：`feat: 实现本地账号登录和会话管理`。

### 第 3 步：统一鉴权与角色保护

- 实现全局 JWT Guard、Public / Roles Decorator。
- 为现有 Controller 标注公开与 Admin / User 权限。
- 让 Chat、Tool Log 写入当前用户 ID。
- 提交：`feat: 为内部接口增加角色权限控制`。

### 第 4 步：前端登录和路由守卫

- 实现 AuthProvider、登录页、请求鉴权、401 单飞刷新。
- 接入菜单裁剪、角色路由和退出。
- 提交：`feat: 新增工作台登录态和权限路由`。

### 第 5 步：成员管理与验收

- 实现用户管理页面、创建成员、禁用、重置密码、撤销会话。
- 运行后端测试、前端 typecheck/build，补充手工验收清单。
- 提交：`feat: 新增成员管理与会话控制`。

## 11. 测试矩阵

| 场景                             | 预期                                         |
| -------------------------------- | -------------------------------------------- |
| 正确邮箱密码登录                 | 返回短期 Access Token，设置 Refresh Cookie。 |
| 错误密码 / 不存在邮箱 / 禁用账号 | 均为统一 401 错误文案。                      |
| 使用合法 Access Token 访问 Chat  | 成功，日志带当前 `userId`。                  |
| 未带 Token 访问内部 Agent 接口   | 401。                                        |
| User 请求模型配置或知识库管理    | 403。                                        |
| Access Token 过期，Refresh 有效  | 成功刷新并重放一次原请求。                   |
| 已撤销 Refresh Token 刷新        | 401，Cookie 被清除。                         |
| 管理员禁用用户                   | 该用户后续受保护请求全部 401。               |
| 重置密码                         | 旧 Refresh Session 失效，必须重新登录。      |
| 公开分享 Agent 查询              | 不需要内部 Token，保持可用。                 |
