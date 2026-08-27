# Mia MCP Client 技术方案

## 1. 文档信息

- 文档状态：待实施
- 方案版本：V1.0
- 编写日期：2026-08-11
- 适用范围：Mia 作为 MCP Host/Client，连接并调用外部 MCP Server
- 协议基线：MCP 2026-07-28，并兼容已部署的 2025-11-25 Streamable HTTP Server

## 2. 背景

Mia 已具备 Builtin Tool、预配置 HTTP Tool、Agent Runtime、Workflow Runtime、动态鉴权和 Run Trace。当前工具接入仍以单个 HTTP API 为中心，缺少标准化的能力发现、Schema 同步、连接健康状态和跨系统复用机制。

MCP 解决的是“Host 如何以统一协议发现并调用外部能力”。对 Mia 来说，近期最有价值的定位是 MCP Host/Client：管理员连接团队认可的 MCP Server，将发现到的 Tool 纳入 Mia 统一工具目录，再授权给 Agent 或 Workflow 使用。

本方案不把 MCP 当作另一套 Agent Runtime，也不让 Chat、公开访问或 Workflow 直接依赖 MCP SDK。MCP 只负责协议与连接生命周期，实际运行仍由现有 `ToolsService` 统一调度。

## 3. 目标与非目标

### 3.1 目标

1. 管理员可以配置、鉴权、测试和停用远程 MCP Server。
2. Mia 可以完成协议协商、`tools/list` 分页发现、Schema 缓存和增量刷新。
3. MCP Tool 与 Builtin Tool、HTTP Tool 使用同一套绑定、模型 Tool Loop、Workflow Tool 节点和调用日志。
4. Agent 只能看到并调用明确绑定且当前可用的 MCP Tool。
5. MCP Secret、OAuth Token 和敏感 Header 不进入 Prompt、普通 API、Run Trace 或应用日志。
6. 调用支持超时、取消、并发限制、输出裁剪、重试分类和健康状态。
7. 为 Resources、Prompts、OAuth 授权码、按用户授权、工具确认和 Mia MCP Server 预留清晰扩展点。

### 3.2 首期非目标

- 不允许用户填写并启动任意 stdio 命令。
- 不安装第三方 MCP 包，不建设 Registry 或插件市场。
- 不支持 MCP Sampling、Roots、Elicitation、Tasks、MCP Apps 和 Skills over MCP。
- 不把 MCP Resources 直接写入知识库。
- 不把 Mia Agent 对外发布为 MCP Server。
- 不实现跨 Workspace 或按用户独立 OAuth 授权。
- 不为 MCP 新建独立 Tool Loop、Workflow 节点或日志体系。

## 4. 成熟系统调研与取舍

### 4.1 MCP 官方协议

MCP 将 Host、Client、Server 分层，并通过 JSON-RPC 暴露 Tools、Resources 和 Prompts。Tool 通过 `tools/list` 发现、通过 `tools/call` 调用，输入和可选输出均使用 JSON Schema。工具名只在单个 Server 内唯一，聚合多个 Server 时客户端必须自行消歧。

2026-07-28 规范的标准 Transport 是 stdio 和 Streamable HTTP。远程服务适合 Streamable HTTP；HTTP 鉴权采用 OAuth 体系并要求资源指示、受保护资源元数据发现、PKCE 和安全 Token 存储。协议同时强调 Tool 描述和 annotations 来自外部 Server，默认不能视为可信安全声明。

对 Mia 的启示：

- 使用官方 TypeScript SDK，不手写 JSON-RPC、SSE 解析和协议协商。
- 运行时 ID 由 Mia 生成，不能直接使用远程工具名作为全局 ID。
- Server 元数据只作为展示和风险评估输入，最终权限由 Mia 本地策略决定。
- 首期只实现 Tools，其他 Capability 必须经过独立设计后显式开启。

### 4.2 Claude Code / Claude Desktop

Claude Code 的成熟点包括：多配置作用域、动态 `list_changed` 刷新、HTTP 断线重连、OAuth 登录与刷新、工具执行超时、输出上限、工具发现延迟加载，以及组织级 `ask/blocked` 控制。它还会把连接失败显式暴露给模型和用户，避免模型假装不存在的工具仍可使用。

对 Mia 的取舍：

- 采用连接状态机、短退避重连、Schema 自动刷新和输出硬上限。
- 采用 `disabled/auto/confirm` 三态策略，但确认流程在后续独立阶段实现。
- 首期限制每个 Agent 绑定的工具数；工具规模变大后再实现 Tool Search，避免一次把大量 Schema 塞进上下文。
- MCP 连接错误必须形成明确 Runtime Event 和 Run Step，不能静默降级成模型自由回答。

### 4.3 Cursor

Cursor 将 MCP Server 分为项目级和全局级配置，支持 stdio、SSE、Streamable HTTP、OAuth、工具开关、调用前审批，以及参数和结果的可展开显示。

对 Mia 的取舍：

- Mia 是单团队服务端产品，连接由管理员集中管理，不照搬桌面端的用户任意命令配置。
- Agent 绑定页显示 Server 来源、工具状态、风险等级和最后同步时间。
- Chat 与 Trace 展示脱敏参数、结果摘要、耗时和错误，不显示 Token 或原始 Header。

### 4.4 Dify

Dify 的成熟优势是 Provider/Tool 两级组织、Credential 校验、Agent 与 Workflow 共用 Tool，以及插件安装、调试和分发体系。它解决的范围比 MCP Client 更大。

对 Mia 的取舍：

- 采用 `McpServer -> McpServerTool` 两级目录，接近 Provider/Tool 心智模型。
- 测试连接与测试工具必须复用正式协议客户端和安全策略。
- Mia 当前不做插件包、插件守护进程和市场，避免把 MCP 接入扩大成开放代码执行平台。

### 4.5 结论

Mia 首期采用“受管远程连接 + 本地工具白名单 + 统一工具网关”。这比桌面 Agent 的任意 stdio 配置更适合团队服务端，也比完整插件平台更符合 Mia 当前维护规模。

## 5. 总体架构

```text
管理端
  -> McpController
     -> McpService
        -> McpConnectionManager
           -> McpProtocolClient
              -> Remote MCP Server

Agent Runtime / Workflow Runtime
  -> ToolsService
     -> Builtin Registry
     -> ConfiguredHttpToolsService
     -> McpService
        -> McpToolExecutor
           -> McpConnectionManager
              -> Remote MCP Server

McpService
  -> Prisma: MCP Server / Tool / Secret / Sync Run
ToolsService
  -> ToolCallLog
Agent Runtime / Workflow Runtime
  -> AgentRunStep / Runtime Event
```

关键约束：

1. `chat`、`agents`、`workflow_runtime` 不 import MCP SDK。
2. `tools -> mcp` 是唯一运行时依赖方向，`mcp` 不反向依赖 `tools`。
3. `McpService` 返回 Mia DTO，不向调用方泄漏 SDK Client、Transport 或 Prisma Model。
4. `ToolsService` 继续是所有工具定义查询、输入脱敏和执行的唯一网关。
5. Agent 与 Workflow 继续绑定统一 `toolId`，不新增 MCP 专用 Tool 节点。

## 6. 模块结构

```text
backend/src/modules/mcp/
  mcp.module.ts
  mcp.controller.ts
  mcp.service.ts
  mcp-connection.manager.ts
  mcp-tool.executor.ts
  mcp-schema.adapter.ts
  mcp-result.adapter.ts
  dto/
    create-mcp-server.dto.ts
    update-mcp-server.dto.ts
    mcp-server.dto.ts
    mcp-tool.dto.ts
    mcp-runtime.dto.ts
  clients/
    mcp-protocol.client.ts
    mcp-auth.provider.ts
    mcp-oauth.client.ts
  tests/

frontend/src/features/mcp/
  McpServersPage.tsx
  api.ts
  types.ts
  components/
    McpServerTable.tsx
    McpServerFormDrawer.tsx
    McpServerDetailDrawer.tsx
    McpToolTable.tsx
    McpConnectionStatus.tsx
    McpToolTestDialog.tsx
```

`mcp-protocol.client.ts` 是官方 SDK 的隔离层。协议版本、SDK 升级和 Transport 差异只能在该层消化。

## 7. 数据模型

### 7.1 `mcp_servers`

| 字段                          | 类型                 | 说明                                                            |
| ----------------------------- | -------------------- | --------------------------------------------------------------- |
| `id`                          | UUID                 | 主键                                                            |
| `name`                        | String               | 展示名称                                                        |
| `slug`                        | String unique        | 稳定标识                                                        |
| `description`                 | Text                 | 管理员说明                                                      |
| `transport`                   | Enum                 | 首期固定 `STREAMABLE_HTTP`                                      |
| `endpoint`                    | String               | MCP Endpoint，不包含 Secret                                     |
| `auth_type`                   | Enum                 | `NONE/BEARER/API_KEY_HEADER/CLIENT_CREDENTIALS`                 |
| `auth_config`                 | JsonB                | 非敏感配置，如 Header 名、Token URL、Scope                      |
| `secret_id`                   | UUID nullable        | 加密 Secret 引用                                                |
| `enabled`                     | Boolean              | 总开关                                                          |
| `allow_private_network`       | Boolean              | 是否允许固定 Host 解析到私网                                    |
| `approval_mode`               | Enum                 | `AUTO/CONFIRM/DISABLED`，首期只执行 `AUTO`                      |
| `connect_timeout_ms`          | Int                  | 建连/首响应超时                                                 |
| `tool_timeout_ms`             | Int                  | 单次 Tool 墙钟超时                                              |
| `max_response_bytes`          | Int                  | 原始响应硬限制                                                  |
| `max_output_chars`            | Int                  | 送入模型和日志前的文本限制                                      |
| `max_concurrency`             | Int                  | Server 级并发槽位                                               |
| `health_status`               | Enum                 | `UNKNOWN/CONNECTING/HEALTHY/DEGRADED/UNAVAILABLE/AUTH_REQUIRED` |
| `negotiated_protocol_version` | String nullable      | 最近协商版本                                                    |
| `server_info`                 | JsonB nullable       | 脱敏后的 Server 信息                                            |
| `capabilities`                | JsonB nullable       | 最近协商 Capability 快照                                        |
| `last_connected_at`           | Timestamptz nullable | 最近连接成功时间                                                |
| `last_discovered_at`          | Timestamptz nullable | 最近工具同步成功时间                                            |
| `last_error_code`             | String nullable      | 稳定错误码                                                      |
| `last_error_message`          | Text nullable        | 脱敏错误摘要                                                    |
| `created_by_user_id`          | UUID                 | 创建管理员                                                      |
| `deleted_at`                  | Timestamptz nullable | 软删除                                                          |
| `created_at/updated_at`       | Timestamptz          | 审计时间                                                        |

约束：

- 首期只接受 `http/https` URL，禁止 userinfo 和 fragment。
- 公网默认要求 HTTPS；HTTP 仅在显式允许私网且 Host 固定时开放。
- Endpoint、重定向和 DNS 解析复用 HTTP Tool 的 SSRF 基础能力，并逐跳校验。

### 7.2 `mcp_server_secrets`

| 字段                    | 类型        | 说明                         |
| ----------------------- | ----------- | ---------------------------- |
| `id`                    | UUID        | 主键                         |
| `encrypted_value`       | Text        | AES-GCM 加密后的 JSON 凭据包 |
| `created_by_user_id`    | UUID        | 创建管理员                   |
| `created_at/updated_at` | Timestamptz | 审计时间                     |

Secret 明文结构按鉴权类型解释：

```json
{
  "token": "...",
  "apiKey": "...",
  "clientId": "...",
  "clientSecret": "..."
}
```

API 只返回 `secretConfigured`。更新时空值表示保留原 Secret，显式 `clearSecret=true` 才清除。

### 7.3 `mcp_server_tools`

| 字段                    | 类型                 | 说明                                  |
| ----------------------- | -------------------- | ------------------------------------- |
| `id`                    | UUID                 | Mia 工具主键                          |
| `server_id`             | UUID                 | 所属 Server                           |
| `remote_name`           | String               | Server 内原始工具名，区分大小写       |
| `runtime_id`            | String unique        | `mcp_{id}`，供 Agent 和 Workflow 绑定 |
| `title`                 | String nullable      | 展示标题                              |
| `description`           | Text                 | 工具描述                              |
| `input_schema`          | JsonB                | 原始 JSON Schema 快照                 |
| `output_schema`         | JsonB nullable       | 可选输出 Schema                       |
| `annotations`           | JsonB nullable       | 不可信提示，只用于辅助展示            |
| `schema_hash`           | String               | 规范化 Schema 的 SHA-256              |
| `enabled`               | Boolean              | Mia 本地开关                          |
| `approval_mode`         | Enum nullable        | 覆盖 Server 默认策略                  |
| `risk_level`            | Enum                 | `LOW/MEDIUM/HIGH`，由管理员确认       |
| `last_seen_at`          | Timestamptz          | 最近发现时间                          |
| `unavailable_at`        | Timestamptz nullable | 远端已不再返回该 Tool                 |
| `created_at/updated_at` | Timestamptz          | 审计时间                              |

唯一约束：`server_id + remote_name`。

工具刷新不能物理删除历史工具。远端不再返回时写 `unavailable_at` 并停止新调用，保证旧 Run Trace 仍可解释。

### 7.4 `mcp_sync_runs`

记录连接测试和 Tool 发现结果：`server_id/status/trigger/source/tool_count/schema_changed_count/error_code/error_message/elapsed_ms/created_at`。

它用于回答“什么时候开始坏的、是鉴权失败还是 Schema 变化”，不保存 Secret、完整响应或工具调用结果。

### 7.5 Agent 与 Workflow 绑定

继续复用 `agent_tools.tool_id` 和 Workflow Tool 节点的 `toolId`：

```text
calculator
http_{uuid}
mcp_{mcp_server_tools.id}
```

不新增 `AgentMcpServer`。工具级绑定本身就是最小权限白名单，避免 Server 级与 Tool 级授权状态互相冲突。

## 8. 统一工具协议适配

### 8.1 Tool Definition

`McpSchemaAdapter` 将远端 Tool 映射为 Mia `ToolDefinition`：

```typescript
{
  id: `mcp_${tool.id}`,
  name: tool.title ?? tool.remoteName,
  description: tool.description,
  inputSchema: tool.inputSchema
}
```

规则：

1. 模型函数名使用 `runtimeId`，解决跨 Server 重名与远程改名问题。
2. UI 同时展示 Server 名和 `remoteName`，便于排查。
3. 只接受 JSON Schema 对象；非法 Schema 使该 Tool 不可用，不影响同 Server 其他 Tool。
4. 首期支持 JSON Schema 2020-12 的常用对象字段；模型 Provider 不支持的组合结构由 Adapter 降级，并记录原因。
5. Schema Hash 变化后保留同一 Tool ID，标记“配置已变化”，管理员可查看差异。

### 8.2 Tool Result

`McpResultAdapter` 处理 `tools/call` 结果：

- `structuredContent`：校验 `outputSchema` 后作为优先结构化结果。
- `text`：拼接为文本结果，并应用字符上限。
- `resource_link` / embedded resource：首期转成可审计的元数据摘要，不自动读取目标资源。
- `image/audio`：首期返回“不支持的媒体结果”摘要，不把 Base64 写入数据库或模型上下文。
- `isError=true`：映射为 `mcp_tool_error`，保留脱敏后的 Server 错误消息。
- 超限内容：保留头尾摘要、原始字节数和 `truncated=true`。

MCP 协议成功但 `isError=true` 属于工具业务失败，不应记录成网络协议成功。

## 9. 连接与发现生命周期

### 9.1 状态机

```text
UNKNOWN
  -> CONNECTING
  -> HEALTHY
  -> DEGRADED
  -> UNAVAILABLE
  -> AUTH_REQUIRED
```

- 保存配置不等于连接成功。
- `initialize`/版本协商成功但 `tools/list` 部分失败时为 `DEGRADED`。
- 401/403 或 Token 刷新失败进入 `AUTH_REQUIRED`。
- 网络、5xx 或超时达到阈值进入 `UNAVAILABLE`。
- 停用 Server 后立即关闭缓存连接并从工具定义中移除。

### 9.2 连接管理

`McpConnectionManager` 按 `serverId + authIdentity` 缓存连接句柄：

1. 首次发现或调用时惰性连接。
2. 每个 Server 一个并发信号量，默认 3，范围 1-10。
3. 空闲连接按 TTL 回收，停用、删除或更新连接配置时主动关闭。
4. 短暂网络和 5xx 使用指数退避；401/403、404、Schema 错误不自动重试。
5. `AbortSignal` 从 SSE/Workflow Runtime 传到 SDK 调用；取消后释放并发槽位。
6. SDK Client 和 Transport 不存入数据库，也不跨进程共享。

### 9.3 Tool 发现

```text
连接并协商 Capability
-> 确认 Server 支持 tools
-> tools/list 分页拉取
-> 校验名称和 JSON Schema
-> 计算 schema_hash
-> 事务内 upsert Tool
-> 标记本轮未出现的 Tool unavailable
-> 更新 Server 状态与 McpSyncRun
```

触发方式：

- 管理员点击“测试并同步”。
- 新建 Server 后首次同步。
- 收到工具列表变化通知后防抖同步。
- 后台每 15 分钟对已启用 Server 做一次轻量刷新。
- Runtime 发现缓存过期时异步触发刷新，但当前调用只使用已发布快照。

同步失败不得清空上一次成功快照；Runtime 根据 Server 健康状态和 Tool 可用状态决定是否允许调用。

## 10. 鉴权设计

### 10.1 M1 支持

- `NONE`
- `BEARER`：固定 `Authorization: Bearer ...`
- `API_KEY_HEADER`：管理员配置 Header 名，值加密存储
- `CLIENT_CREDENTIALS`：复用现有动态 Token 获取、缓存、提前刷新和 401 后单次刷新重试能力

固定 Header 仅允许管理员配置，禁止 `Host/Content-Length/Cookie/Proxy-Authorization`。`Authorization` 只能由鉴权模块生成，不能同时出现在普通 Header 中。

### 10.2 标准 OAuth 阶段

后续实现 MCP OAuth Authorization Code + PKCE：

1. 根据 `WWW-Authenticate` 与 Protected Resource Metadata 发现 Authorization Server。
2. 使用 Authorization Server Metadata 或 OIDC Discovery 获取端点。
3. 支持预注册 Client 与兼容的 Client Registration 方式。
4. Authorization 和 Token 请求携带目标 MCP Server 的 `resource`。
5. 加密保存 Access Token、Refresh Token、到期时间和授权 Scope。
6. 到期前刷新；401 时刷新并仅重试一次；刷新失败进入 `AUTH_REQUIRED`。
7. 禁止把 MCP Access Token 透传给 MCP Server 的下游 API。

Mia 首期采用团队共享服务身份。按用户独立 OAuth 必须新增 `mcp_user_authorizations`，并把连接缓存键扩展为 `serverId + userId`，不得把不同用户 Token 共用。

## 11. Runtime 执行流程

```text
Agent Runtime / Workflow Tool Executor
-> ToolsService.getToolDefinitions(boundToolIds)
-> 模型返回 mcp_{toolId} + arguments
-> ToolsService.executeTool
-> McpService.resolveRuntimeTool
-> 校验 Server/Tool/绑定状态与审批策略
-> 校验 arguments JSON Schema
-> 获取 Server 并发槽位
-> McpToolExecutor.callTool(remoteName, arguments, signal)
-> McpResultAdapter 归一化、裁剪、脱敏
-> ToolsService 写 ToolCallLog
-> Runtime 写 AgentRunStep 和 Runtime Event
-> 模型继续生成
```

执行前必须再次按数据库状态解析工具，不能仅信任模型看到的旧 Tool Definition。这样管理员停用 Server 或 Tool 后，无需等待会话结束即可阻止新调用。

### 11.1 错误类型

| 错误码                  | 是否自动重试         | 说明                            |
| ----------------------- | -------------------- | ------------------------------- |
| `mcp_server_disabled`   | 否                   | Server 已停用或删除             |
| `mcp_tool_unavailable`  | 否                   | Tool 停用、未发现或 Schema 无效 |
| `mcp_auth_required`     | 否                   | 需要重新鉴权                    |
| `mcp_invalid_arguments` | 否                   | 入参不符合 Schema               |
| `mcp_connect_timeout`   | 可重试一次           | 建连/首响应超时                 |
| `mcp_tool_timeout`      | 否                   | Tool 墙钟超时，避免重复副作用   |
| `mcp_network_error`     | 只读 Tool 可重试一次 | 网络错误                        |
| `mcp_protocol_error`    | 否                   | 协议或响应结构不合法            |
| `mcp_tool_error`        | 否                   | Server 返回 `isError=true`      |
| `mcp_output_too_large`  | 否                   | 原始响应超过硬限制              |
| `canceled`              | 否                   | 用户或 Runtime 取消             |

默认不重试 `tools/call`，因为远端 Tool 是否幂等不能从名称推断。只有管理员明确标记为只读且调用尚未收到业务结果时，才允许一次瞬时错误重试。

## 12. 审批与风险控制

Tool annotations 只能作为风险建议，最终风险等级和审批策略由管理员保存：

```text
DISABLED：模型不可见、不可执行
AUTO：绑定后可自动执行
CONFIRM：每次执行前需要用户确认
```

M1 先支持 `DISABLED/AUTO`。配置为 `CONFIRM` 的 Tool 不进入模型 Tool Definition，并提示“当前版本尚未启用交互审批”。

M2 增加可恢复审批：

- 新增 `tool_approval_required/tool_approval_resolved` Runtime Event。
- Chat SSE 展示工具名、Server、脱敏参数和风险说明。
- Run 状态进入 `WAITING_INPUT`，审批后从同一 Step 恢复。
- 公开访问和 Service API 默认拒绝 `CONFIRM` 工具；只有调用方提供可信审批回调时开放。
- Workflow 首期不暂停等待用户，必须通过发布时审批策略将节点固定为允许或拒绝。

## 13. API 设计

管理员接口：

- `GET /api/v1/mcp/servers`
- `POST /api/v1/mcp/servers`
- `GET /api/v1/mcp/servers/:id`
- `PUT /api/v1/mcp/servers/:id`
- `DELETE /api/v1/mcp/servers/:id`
- `POST /api/v1/mcp/servers/:id/test`
- `POST /api/v1/mcp/servers/:id/sync-tools`
- `GET /api/v1/mcp/servers/:id/tools`
- `PUT /api/v1/mcp/servers/:id/tools/:toolId`
- `POST /api/v1/mcp/servers/:id/tools/:toolId/test`
- `GET /api/v1/mcp/servers/:id/sync-runs`

成员接口不直接暴露 Server 配置。现有 `GET /api/v1/tools` 返回可绑定的统一工具列表，MCP Tool 增加以下非敏感字段：

```json
{
  "id": "mcp_...",
  "name": "查询订单",
  "description": "...",
  "enabled": true,
  "sourceType": "mcp",
  "sourceName": "内部订单系统",
  "healthStatus": "healthy",
  "riskLevel": "low"
}
```

测试 Tool 接口接收业务参数，不接收 Endpoint、Token 或 Header 覆盖值。

## 14. 管理界面

### 14.1 MCP Server 列表

展示名称、Transport、鉴权类型、健康状态、工具数、最后同步时间和最近错误。支持新增、测试、同步、停用和删除。

### 14.2 Server 配置抽屉

配置项：

- 基础信息
- Streamable HTTP Endpoint
- 鉴权模式与 Secret
- 私网开关和固定 Host 提示
- 连接、工具执行、输出和并发限制
- 默认审批策略

保存前只做本地格式校验；“测试并同步”才访问外部 Server。失败时保留配置并展示分类错误。

### 14.3 Tool 目录

每个 Tool 展示标题、远程名、描述、启用状态、风险等级、审批策略、Schema Hash 和最后发现时间。支持查看 Schema、测试参数、停用和查看 Schema 变更。

Agent 工具绑定页按来源分组：内置工具、HTTP API、MCP Server。只有切换到工具绑定页才加载完整工具目录，但绑定数量继续随 Agent 详情首次加载返回，避免旧的数量显示问题重现。

## 15. Run Trace 与日志

MCP 不新建调用日志表，继续写现有 `ToolCallLog` 和 `AgentRunStep`。

建议 Runtime Event：

```text
tool_call          现有：runtimeId、脱敏参数
tool_result        现有：结果摘要、耗时、truncated
mcp_connect_start  管理/调试 Trace 可选
mcp_connect_end    协议版本、Server、耗时、状态
mcp_sync_end       工具数、Schema 变化数、状态
```

ToolCallLog 补充的 `source` 使用 `mcp`，`toolId` 保存稳定 Runtime ID。AgentRunStep metadata 保存 `mcpServerId/mcpToolId/remoteName/protocolVersion`，不保存 Secret、Authorization、Cookie、完整 OAuth 响应或 Base64 媒体。

日志查询页支持按 `source=mcp`、Server 和 Tool 筛选，并区分连接失败、鉴权失败、协议失败、业务失败和取消。

## 16. 安全设计

### 16.1 网络安全

- 默认拒绝 loopback、link-local、RFC1918、保留地址和云元数据地址。
- 私网访问必须由管理员对单个固定 Host 显式开启。
- DNS 解析与每次重定向都重新校验，防止 DNS rebinding 和开放重定向绕过。
- 公网 Endpoint 使用 HTTPS 并校验证书，不允许关闭 TLS 校验。
- Endpoint 更新后立即关闭旧连接并清除 Session 状态。

### 16.2 Prompt Injection 与工具投毒

- Server instructions、Tool description、annotations 和 Tool result 都是不可信外部输入。
- Tool description 有长度上限，去除不可见控制字符，不允许覆盖平台 System Prompt。
- Tool result 使用独立 Tool Message 进入模型，不拼接进 System Prompt。
- Tool Result 中的 Resource Link 不自动抓取，防止模型触发二次越权读取。M6-B 只允许管理员从资源目录显式预览或导入。
- Schema 变化后不能自动扩大权限；新 Tool 默认停用。

### 16.3 Secret 与隐私

- Secret 使用现有 AES-GCM 基础设施加密，密钥仅来自运行环境。
- 解密只发生在调用边界，明文不进入 DTO、缓存 key、异常或日志。
- Header 名按大小写不敏感脱敏 `authorization/cookie/set-cookie/x-api-key` 及管理员声明字段。
- 工具输入和结果分别设置敏感字段规则与长度上限。
- 测试连接和正式调用执行同一脱敏逻辑。

### 16.4 资源限制

建议默认值：

| 项目                  | 默认        | 最大         |
| --------------------- | ----------- | ------------ |
| 建连/首响应超时       | 10 秒       | 30 秒        |
| 单次 Tool 超时        | 30 秒       | 120 秒       |
| 每 Server 并发        | 3           | 10           |
| 单次 Run MCP 调用数   | 8           | 20           |
| 原始响应              | 1 MB        | 5 MB         |
| 送入模型文本          | 20,000 字符 | 100,000 字符 |
| 单 Server Tool 数     | 100         | 500          |
| 单 Agent 绑定 Tool 数 | 20          | 50           |

## 17. 可观测性

指标：

- `mcp_connection_attempt_total{server,status}`
- `mcp_tool_discovery_total{server,status}`
- `mcp_tool_call_total{server,tool,status}`
- `mcp_tool_call_duration_ms`
- `mcp_auth_refresh_total{server,status}`
- `mcp_active_connections`
- `mcp_output_truncated_total`

告警建议：

- 已启用 Server 连续 3 次同步失败。
- 5 分钟窗口鉴权失败率超过 20%。
- Tool P95 超过配置超时的 80%。
- Schema 变化导致已绑定 Tool 不可用。

对 20-50 人本地部署，首期指标可先落结构化日志与管理页统计，不强制引入新的监控基础设施。

## 18. Tool 数量与上下文控制

Mia 当前会把 Agent 绑定工具的完整 Schema 发送给模型。首期采用硬上限和管理员绑定，足以覆盖内部使用：

1. 单 Agent 默认最多绑定 20 个 Tool。
2. 只发送健康、启用且已绑定的工具。
3. 描述截断并把重要用途放在前部。
4. 记录工具 Schema 对模型输入 Token 的占用。

当团队接入超过约 100 个 MCP Tool 或单 Agent 经常需要 30 个以上 Tool 时，进入 M6：建立轻量 Tool Catalog，先按名称、描述和标签检索候选 Tool，再只把候选 Schema 注入模型。该能力属于 Runtime 的 Tool Search，不应由 MCP 模块直接调用 LLM。

## 19. 实施阶段

### M0：协议验证与依赖锁定

- 用官方 TypeScript SDK 建立最小 Streamable HTTP Client Spike。
- 验证 Node 22、NestJS、AbortSignal、代理、私网 Endpoint 和当前模型 Provider 的 Schema 兼容性。
- 固定 SDK 精确版本，记录兼容的协议版本和升级检查项。
- 准备一个只读测试 Server，覆盖无鉴权与 Bearer。

验收：可以完成连接、工具分页发现、工具调用、取消和关闭，不进入业务代码。

### M1：后端连接与工具发现

- 新增 Prisma Model、Migration 和 `mcp` 模块。
- 实现 Server CRUD、Secret 加密、SSRF 校验、连接测试和 Tool 同步。
- 实现状态机、Sync Run、Schema Hash 和软失效。
- 增加 Service 主路径、鉴权失败、非法 Schema、分页和同步回滚测试。

验收：管理员 API 可管理 Server，发现失败不破坏上次成功快照。

### M2：统一 ToolsService 与 Runtime

- `ToolsService` 合并 MCP Tool 列表与定义。
- 实现 `McpToolExecutor`、参数校验、结果适配、超时、取消和并发限制。
- Agent Runtime 与 Workflow Tool Executor 无感调用 MCP Tool。
- 完整写入 ToolCallLog、Run Step 和 Runtime Event。

验收：Chat、公开访问、Service API、Workflow 使用同一绑定可以调用 MCP Tool，且错误可追踪。

### M3：管理端与绑定体验

- 实现 MCP Server 页面、配置抽屉、状态、同步、Tool 目录和测试弹窗。
- Agent 工具绑定页增加来源分组、健康状态、风险与 Schema 变化提示。
- 日志页增加 MCP 来源筛选。

验收：管理员不依赖命令行即可完成配置、测试、同步、授权和排障。

### M4：动态鉴权与连接韧性

- 接入 Client Credentials。
- 增加短退避重连、Token 提前刷新、401 单次刷新重试和健康巡检。
- 支持工具列表变化通知与定时刷新。

验收：短期 Token 失效后无需人工更新 Header；远端短暂故障不会造成长期假健康。

### M5：标准 OAuth 与审批

- 实现 MCP OAuth Authorization Code + PKCE、发现、Scope 和重新授权。
- 实现 `CONFIRM` Tool 的 Run 暂停/恢复和 Chat 审批 UI。
- 明确公开访问、Service API 和 Workflow 的非交互审批策略。

验收：敏感 Tool 未确认不能执行，Token 可安全刷新与撤销。

### M6：规模化能力

M6 按可独立上线的子阶段实施，避免资源导入、成员授权和本地进程执行同时扩大风险面：

1. **M6-A Tool Catalog / Tool Search（已实现）**：绑定普通工具超过 20 个时，Runtime 先按用户问题和 System Prompt 检索轻量目录，最多选择 12 个候选，再延迟加载完整 Schema。检索写入 `TOOL_SEARCH` Step 和 Runtime Event；小规模 Agent 保持完整 Schema 行为。
2. **M6-B Resources（已实现）**：通过短连接实时发现 Resource 与 Resource Template，管理端提供只读目录与最多 5 万字符预览；只有管理员显式选择目标知识库后才复制不超过 5 MB 的文本内容，并复用知识库文件校验、存储、切分和 Embedding 链路。Resource URI 只作为 MCP 协议参数传递，不由 Mia 直接抓取；模型、Tool Result 和 MCP Server 均无自动导入权限。
3. **M6-C Prompts**：发现 Prompt、参数和消息预览，管理员显式导入为 Mia Skill 草稿；远端后续变化不得自动覆盖已导入 Skill。
4. **M6-D 按用户 OAuth**：共享授权与成员授权使用独立数据模型和 Token 缓存键，运行时按调用用户选择授权；公开访问、Service API 和 Workflow 继续使用明确的非交互策略。
5. **M6-E stdio 评估**：仅允许管理员选择平台预置命令，协议进程在独立 Worker/容器中运行。完成威胁模型、资源限制和审计验证前，不在 NestJS API 进程开放 stdio。

M6-B 管理接口：

```text
GET  /api/v1/mcp/servers/:id/resources
POST /api/v1/mcp/servers/:id/resources/preview
POST /api/v1/mcp/servers/:id/resources/import
```

三类接口均继承 MCP Server 管理员权限，并复用 Server 的 SSRF、动态鉴权与超时配置。URI Template 当前只展示定义，不在客户端猜测参数或自动展开。

### M7：Mia 作为 MCP Server

另建技术方案，将已发布 Workflow 或 Agent 暴露为受控 MCP Tool。该阶段必须独立处理调用方身份、Scope、限流、幂等、对外审计和版本发布，不能复用“连接外部 Server”的管理模型代替。

## 20. 测试策略

### 20.1 单元测试

- URL、DNS、重定向和 Header 安全校验。
- Schema 规范化、Hash、Provider 降级和参数校验。
- MCP Result 的 text、structured、error、超限和不支持媒体映射。
- 状态机、重试分类、Token 刷新和日志脱敏。

### 20.2 集成测试

- 内存测试 Server：无鉴权、Bearer、分页、Schema 更新、`isError`、超时和断线。
- Prisma：同步事务、软失效、绑定稳定性和 Secret 不泄漏。
- ToolsService：Builtin、HTTP、MCP 混合列表和执行。
- Agent Runtime / Workflow Runtime：事件顺序、取消、失败策略和 Run Trace。

### 20.3 前端测试

- 表单切换鉴权模式时不回显 Secret。
- 同步失败保留旧 Tool，并显示最新错误。
- 绑定数量首次加载正确。
- Tool 测试和 Trace 中敏感字段被脱敏。

### 20.4 回归验证

- `npm run prisma:validate`
- `npm run prisma:generate`
- 后端 `npm run typecheck && npm test`
- 前端 `npm run typecheck && npm run build`
- 使用真实 Streamable HTTP Server 做一次连接、发现、调用、取消和 Token 过期演练

所有 Node 命令使用 Node.js 22。

## 21. 发布与回滚

1. 数据库 Migration 先发布，MCP 功能开关默认关闭。
2. 后端发布后只允许管理员创建测试 Server，不向 Agent 暴露。
3. 完成真实 Server 验证后开启统一工具目录。
4. 先为测试 Agent 绑定只读 Tool，再逐步扩大。
5. 回滚时关闭 MCP 功能开关和所有连接；保留 Server、Tool 快照及历史 Trace，不删除绑定记录。

## 22. 验收标准

1. 管理员可配置 Streamable HTTP Server，并完成连接测试与 Tool 同步。
2. 多个 Server 存在同名 Tool 时仍生成唯一、稳定的 Runtime ID。
3. 新发现 Tool 默认停用，只有管理员启用并绑定后模型才可见。
4. Chat、公开访问、Service API 和 Workflow 复用同一 ToolsService 执行路径。
5. Server 或 Tool 停用后，已有会话下一次调用立即失败且错误明确。
6. Secret、Token、Cookie 和敏感 Header 不出现在 API、Prompt、日志和 Trace。
7. 参数、输出、超时、取消、并发和调用次数限制全部生效。
8. 同步失败保留上一次成功快照；远端删除 Tool 后历史 Trace 仍可解释。
9. 工具调用成功、业务失败、鉴权失败、协议失败和取消均可在日志中区分。
10. Prisma、后端测试、前端 typecheck/build 和真实 Server 冒烟验证通过。

## 23. 主要风险与应对

| 风险                              | 应对                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| MCP 规范与 SDK 变化快             | SDK 隔离层、精确锁版本、兼容测试、按阶段升级                        |
| 恶意 Server 描述或结果注入 Prompt | 外部内容不可信、独立 Tool Message、长度限制、禁止覆盖 System Prompt |
| MCP Tool 权限过大                 | 管理员连接、工具级白名单、风险等级、审批和最小凭据                  |
| stdio 造成任意代码执行            | 首期不支持；后续仅预置命令加独立 Worker 沙箱                        |
| Tool Schema 过多挤占上下文        | 绑定上限、描述裁剪、后续 Tool Search                                |
| 重试造成重复副作用                | `tools/call` 默认不重试，仅显式只读 Tool 可重试                     |
| Token 串用或泄漏                  | 加密存储、身份隔离缓存键、Audience/Resource 约束、日志脱敏          |
| Server 故障导致模型编造           | 将不可用状态显式写入 Runtime，禁止静默跳过后继续假装成功            |

## 24. 实施顺序结论

建议按 `M0 -> M1 -> M2 -> M3 -> M4 -> M5` 开发。M0-M3 构成可用的内部 MCP V1，M4 补齐动态鉴权和运行稳定性，M5 才进入标准 OAuth 与人工审批。

第一轮实施不要同时做 Resources、Prompts、stdio 和 Mia MCP Server。先让一条远程 Tool 从“管理员连接、发现、启用、绑定、调用”完整穿过 Agent Runtime、Workflow Runtime 和 Run Trace，形成可验证闭环，再扩展协议能力。

## 25. 参考资料

- [MCP 2026-07-28 Specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP TypeScript SDK Client Guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Cursor MCP](https://docs.cursor.com/context/model-context-protocol)
- [Dify Tool Plugin](https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/tool-plugin)
