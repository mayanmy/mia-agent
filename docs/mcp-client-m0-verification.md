# Mia MCP M0 协议验证记录

## 1. 验证结论

M0 已完成。Mia 后端可以在 Node.js 22 下使用官方 TypeScript SDK 通过 Streamable HTTP 完成 MCP 2026-07-28 协议连接，并为 2025-era Server 保留自动回退能力。

本阶段只建设协议隔离层和真实 HTTP 集成测试，不访问业务表、不接入 `ToolsService`，也不向 Agent 暴露 MCP Tool。

## 2. 锁定依赖

生产依赖：

- `@modelcontextprotocol/client@2.0.0`

测试依赖：

- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/node@2.0.0`

三个包均精确锁定为 `2.0.0`，要求 Node.js 20 以上。Mia 的构建和测试继续显式使用 Node.js `22.12.0`。

## 3. 已验证能力

1. Streamable HTTP 真实本地端口连接。
2. `versionNegotiation.mode=auto` 协商到 MCP `2026-07-28`。
3. `tools/list` 多页结果自动聚合。
4. `tools/call` 文本和 `structuredContent` 返回。
5. `AbortSignal` 中止 HTTP Tool 请求并传播到 Server Handler。
6. SDK 包装取消错误后，Mia 重新归一化为标准 `AbortError`。
7. Client 关闭幂等，连接失败时主动清理 Transport 句柄。
8. SDK 类型被限制在 `McpProtocolClient` 内部，对外只暴露可 JSON 序列化 DTO。

## 4. SDK 2.0 兼容要点

- SDK 默认仍采用 legacy 握手；Mia 必须显式启用 `versionNegotiation.mode=auto`。
- `listTools()` 无 cursor 调用会自动聚合分页，Mia 保留最大页数限制。
- Server Request Handler 使用 method 字符串注册，例如 `tools/list`、`tools/call`。
- Server 侧取消信号位于 `context.mcpReq.signal`。
- Client 侧取消可能以 `SdkError` 包装返回，不能直接依赖 SDK Error 名称。
- Client 与 Server 包同时提供 CommonJS 导出，可兼容 Mia 当前 NestJS CommonJS 构建。

## 5. 验证命令

```bash
cd backend
env PATH=/Users/yanma/.nvm/versions/node/v22.12.0/bin:/usr/bin:/bin \
  /Users/yanma/.nvm/versions/node/v22.12.0/bin/npm run typecheck

env PATH=/Users/yanma/.nvm/versions/node/v22.12.0/bin:/usr/bin:/bin \
  /Users/yanma/.nvm/versions/node/v22.12.0/bin/npm test
```

验证结果：后端类型检查通过，`118/118` 测试通过。

真实 HTTP 集成测试需要监听 `127.0.0.1` 随机端口；受限沙箱环境需要授予本地监听权限。

## 6. 下一阶段

M1 新增 Prisma 数据模型、Migration、`McpModule`、Server CRUD、Secret 加密、连接测试和 Tool 同步。M1 必须复用本阶段的 `McpProtocolClient`，不得在 Service 中直接调用官方 SDK。
