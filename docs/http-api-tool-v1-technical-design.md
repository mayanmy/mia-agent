# Mia 预配置 HTTP API Tool V1 技术方案

## 1. 背景与目标

Mia 当前的 `http_request` 是模型可直接填写 URL 的通用内置工具，适合受控调试，但不适合稳定接入内部业务接口。V1 新增“预配置 HTTP API Tool”：管理员固定请求地址、方法、鉴权与安全策略，模型只填写声明过的业务参数。

核心原则：

1. 模型只接触工具名称、描述和业务参数 Schema，不接触 URL、固定 Header 或 Secret。
2. HTTP 请求只能由后端执行，前端测试也必须经过同一个执行器。
3. 创建、测试、Agent Runtime 复用同一套参数校验、请求组装和 SSRF 策略。
4. Run Trace 与工具日志只记录脱敏输入输出，不记录 Authorization、Cookie 或 Secret。
5. 保留现有内置工具 ID；预配置工具使用 `http_{uuid}` 作为稳定运行时 ID，满足模型函数名字符约束。

## 2. V1 范围

支持：

- HTTP/HTTPS、GET/POST。
- Path、Query、Header、JSON Body 参数。
- 固定 Header。
- 无鉴权、Bearer、API Key Header。
- Secret AES-GCM 加密存储，API 只暴露是否已配置。
- 超时、响应体大小、重定向次数限制。
- 默认阻止私网；单个工具显式开启私网并固定目标 Host。
- 管理端 CRUD、测试调用、Agent 绑定、Runtime 执行和调用日志。

不支持：

- PUT/PATCH/DELETE、form-data、文件和二进制上传。
- OAuth、HMAC、Cookie Session。
- JSONPath、重试、熔断和错误分支编排。
- 任意 URL 变量；参数不得改变 scheme、host 或 port。

## 3. 数据模型

### 3.1 `http_tools`

保存工具元数据、固定请求配置、模型输入 Schema 和安全策略。删除采用软删除，避免历史 Run Trace 无法解释工具来源。

关键字段：

- `id/name/slug/description/enabled`
- `method/base_url/path`
- `parameters/fixed_headers`
- `auth_type/auth_header_name/secret_id`
- `timeout_ms/max_response_bytes/allow_private_network`
- `created_by_user_id/deleted_at`

### 3.2 `tool_secrets`

保存 AES-GCM 密文。Secret 由 HTTP Tool 独占，更新时覆盖密文，删除工具时级联删除。所有详情 DTO 只返回 `secretConfigured`。

### 3.3 Agent 绑定兼容

现有 `agent_tools.tool_id` 是字符串，无需迁移结构：

```text
calculator
current_time
http_request
http_{http_tools.id}
```

## 4. 模块与执行流程

```text
ToolsController
  -> ToolsService
     -> HttpToolExecutor
        -> validateInput
        -> build URL / headers / JSON body
        -> inject decrypted secret
        -> resolve DNS and enforce SSRF policy
        -> fetch with timeout and redirect checks
        -> limit and parse response
     -> record sanitized ToolCallLog
```

`ToolsService.getToolDefinitions` 改为异步，将内置注册表与数据库 HTTP Tool 合并。Agent Runtime 和 Agent 工具绑定校验必须等待该结果。

## 5. API

成员可用：

- `GET /api/v1/tools`：列出可绑定的内置和预配置工具。

管理员可用：

- `GET /api/v1/tools/http`
- `POST /api/v1/tools/http`
- `GET /api/v1/tools/http/:id`
- `PUT /api/v1/tools/http/:id`
- `DELETE /api/v1/tools/http/:id`
- `POST /api/v1/tools/http/:id/test`

测试接口接收与模型相同的业务参数，不接收 URL、Header 或 Secret。

## 6. 请求组装规则

1. Path 参数按 `{parameterName}` 替换并执行 `encodeURIComponent`。
2. Query 参数通过 `URLSearchParams` 添加。
3. Header 参数只能写入声明过的 Header，禁止 `host/content-length/authorization/cookie`。
4. Body 参数组成 JSON 对象；POST 自动设置 `Content-Type: application/json`。
5. 固定 Header 与鉴权最后注入，模型参数不能覆盖。

模型参数名与 HTTP 字段名分离：`name` 必须满足模型函数字段约束，`targetName` 可映射为实际的 Path 占位符、Query key、Header 名或 JSON 字段名。例如 `tenantId -> X-Tenant-ID`。

## 7. 安全与日志

- URL 配置阶段只接受 HTTP/HTTPS，不接受 URL 用户信息或 fragment。
- 执行阶段解析 DNS，拦截 loopback、link-local、RFC1918 和常见 IPv6 私网地址。
- `allowPrivateNetwork=true` 仅放开该工具固定 Host 的私网解析结果。
- 重定向每一跳重新校验，最多三次。
- 请求超时默认 10 秒、最大 30 秒；响应默认 1 MB、最大 5 MB。
- 工具输入中标记为敏感的 Header 参数在日志中写为 `[REDACTED]`。
- 只返回必要响应 Header；不记录 `set-cookie`。

## 8. 验收标准

1. 管理员可创建并测试无鉴权和 Bearer/API Key 的 HTTP Tool。
2. Secret 不出现在列表、详情、测试结果、ToolCallLog 和 Agent Run Step。
3. Agent 可绑定 `http_{uuid}`，模型看到业务参数 Schema 并能完成调用。
4. 停用或删除工具后不能新增绑定，也不能在 Runtime 执行。
5. 默认拦截 localhost/私网；显式启用后可调用固定的 Docker 内部服务。
6. Prisma validate/generate、后端测试、前端 typecheck/build 全部通过。

## 9. V2 后续

- PUT/PATCH/DELETE、Raw、Form URL Encoded、Multipart、文件。
- Basic Auth、OAuth Client Credentials、Secret 复用与轮换。
- JSONPath 输出映射、重试、错误分支、限流和熔断。
- OpenAPI 导入与批量生成工具。
- 独立出站代理和更细粒度网络策略。
