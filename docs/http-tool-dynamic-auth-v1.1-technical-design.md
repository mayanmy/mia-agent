# HTTP Tool 动态鉴权 V1.1 技术方案

## 1. 背景与目标

Mia HTTP Tool V1 已支持无鉴权、静态 Bearer Token 和静态 API Key。V1.1 增加两种运行时动态鉴权：

1. OAuth2 `client_credentials`：按照标准协议获取访问令牌。
2. 自定义 Token 接口：通过管理员配置的请求参数调用非标准 Token API，并从 JSON 响应中提取令牌。

本阶段不实现 OAuth2 Authorization Code、用户级授权、浏览器跳转授权、mTLS 和分布式 Token 缓存。

## 2. 设计原则

- 模型只填写业务参数，不能提供 Token URL、客户端密钥或鉴权 Header。
- 非敏感鉴权规则写入 `http_tools.auth_config`；敏感凭据整体加密后写入 `tool_secrets.encrypted_value`。
- 管理 API 只返回凭据是否已配置和凭据键名，不返回明文或密文。
- Token 获取请求复用 HTTP Tool 的协议、DNS、私网、重定向、超时和响应大小限制。
- Token 在进程内按工具版本缓存；同一工具并发刷新时合并为一次请求。
- 业务接口返回 401 时，仅强制刷新 Token 并重试一次，避免无限重试或重复执行。
- Token 请求、Token 响应和凭据不进入模型上下文、SSE、Run Trace 或普通日志。

## 3. 鉴权类型

### 3.1 OAuth2 Client Credentials

配置字段：

| 字段                   | 含义                   | 默认值         |
| ---------------------- | ---------------------- | -------------- |
| `tokenUrl`             | Token 接口完整 URL     | 必填           |
| `clientAuthMethod`     | `body` 或 `basic`      | `body`         |
| `scope`                | OAuth2 scope           | 空             |
| `audience`             | 可选 audience          | 空             |
| `tokenField`           | Token 响应字段路径     | `access_token` |
| `expiresInField`       | 相对过期秒数字段路径   | `expires_in`   |
| `expiresAtField`       | 绝对过期时间字段路径   | 空             |
| `tokenTypeField`       | Token 类型字段路径     | `token_type`   |
| `defaultTtlSeconds`    | 无过期字段时的缓存时间 | 300            |
| `refreshBeforeSeconds` | 提前刷新窗口           | 60             |

加密凭据固定为 `clientId` 和 `clientSecret`。请求使用
`application/x-www-form-urlencoded`，携带 `grant_type=client_credentials`。

### 3.2 自定义 Token 接口

配置字段：

| 字段                   | 含义                                    | 默认值             |
| ---------------------- | --------------------------------------- | ------------------ |
| `tokenUrl`             | Token 接口完整 URL                      | 必填               |
| `method`               | `GET` 或 `POST`                         | `POST`             |
| `contentType`          | `application_json` 或 `form_urlencoded` | `application_json` |
| `parameters`           | Token 请求参数映射                      | `[]`               |
| `tokenField`           | Token 响应字段路径                      | `access_token`     |
| `expiresInField`       | 相对过期秒数字段路径                    | `expires_in`       |
| `expiresAtField`       | 绝对过期时间字段路径                    | 空                 |
| `tokenTypeField`       | Token 类型字段路径                      | `token_type`       |
| `headerName`           | 注入业务请求的 Header                   | `Authorization`    |
| `tokenPrefix`          | Token 前缀；空字符串表示直接注入        | `Bearer`           |
| `defaultTtlSeconds`    | 无过期字段时的缓存时间                  | 300                |
| `refreshBeforeSeconds` | 提前刷新窗口                            | 60                 |

每个请求参数包含：

- `name`：目标字段名。
- `location`：`header`、`query` 或 `body`。
- `value`：非敏感固定值。
- `credentialKey`：引用加密凭据字典中的键；与 `value` 二选一。

响应字段使用点号路径，例如 `data.accessToken`。V1.1 不支持完整 JSONPath，避免引入表达式执行能力。

## 4. 数据模型与 API

`http_tools` 新增 `auth_config JSONB NOT NULL DEFAULT '{}'`。`ToolSecret.encryptedValue` 的语义扩展为：

- 静态鉴权：加密后的原始字符串。
- 动态鉴权：加密后的 JSON 凭据字典。

创建或更新接口新增：

```json
{
  "authType": "oauth2_client_credentials",
  "authConfig": {
    "tokenUrl": "https://auth.example.com/oauth/token",
    "clientAuthMethod": "body",
    "scope": "orders.read"
  },
  "credentials": {
    "clientId": "mia",
    "clientSecret": "secret"
  }
}
```

编辑时不传 `secret` / `credentials` 表示保留现有值；提交部分动态凭据时与现有凭据合并。V1.1 通过切换为“无鉴权”清除整组凭据，不提供单键删除。切换鉴权类型时必须提交新类型所需凭据，防止把旧格式密文误用为新格式。

## 5. 运行时流程

```text
校验模型业务参数
  -> 构造业务请求（暂不注入鉴权）
  -> 静态鉴权：直接注入加密存储的静态值
  -> 动态鉴权：读取有效 Token 缓存
       -> 缓存失效：进入 singleflight
       -> 调用 Token API
       -> 解析 Token 与过期时间
       -> 写入进程内缓存
  -> 注入业务请求 Header
  -> 调用业务 API
  -> 非 401：返回脱敏结果
  -> 401 且为动态鉴权：清除缓存、强制刷新、仅重试一次
```

缓存键使用 `httpToolId + updatedAt`。配置更新后版本变化，旧 Token 即使尚未过期也不会被复用。

## 6. Token 有效期

过期时间按以下优先级计算：

1. `expiresAtField`：ISO 时间、Unix 秒或 Unix 毫秒。
2. `expiresInField`：从当前时间起的秒数。
3. `defaultTtlSeconds`。

当 `now >= expiresAt - refreshBeforeSeconds` 时视为需要刷新。配置校验保证默认 TTL 和刷新窗口为正数，并限制最大值。

## 7. 安全与故障处理

- Token URL 禁止 URL 用户名密码，默认禁止本机、私网和保留地址；工具显式启用私网后才允许本地服务。
- Token 请求 Header 禁止 `Host`、`Content-Length`、`Cookie`、`Proxy-Authorization` 和 `Transfer-Encoding`。
- Token 响应最多读取 1 MB；只接受 2xx 与 JSON 对象。
- 缺少凭据、字段路径不存在、Token 为空、过期时间非法均返回明确配置错误。
- 业务响应中匹配凭据值、Token 值或敏感字段名的内容统一替换为 `[REDACTED]`。
- 业务请求 401 重试不会扩展到其他状态码；POST 业务接口可能非幂等，因此仅在服务明确返回 401 时重试。

## 8. 可观测性

V1.1 记录非敏感运行信息：鉴权类型、Token 缓存命中/刷新/失败、Token 请求耗时、401 重试次数和错误分类。日志禁止记录请求凭据、完整 Token 请求体、Token 响应体和注入后的 Authorization。

本阶段先依赖现有 Tool Call / Run Trace 记录最终成功或失败。后续可新增独立的 `auth_token_refresh` Runtime Event。

## 9. 测试范围

- client credentials 的 body/basic 请求格式、Token 提取和业务 Header 注入。
- 自定义 Token 请求的 header/query/body 参数映射和嵌套字段提取。
- 缓存命中、提前刷新和并发 singleflight。
- 401 清缓存、刷新并只重试一次。
- Token URL SSRF、响应大小、非法 JSON、缺失字段和取消/超时。
- 管理接口不回传凭据；业务响应不会回显 Token 或凭据。

## 10. 后续阶段

- V1.2：Token 刷新事件进入 Run Trace，增加缓存指标和后台连通性检查。
- V2：Redis 分布式 Token 缓存与分布式锁，支持多实例部署。
- V2：OAuth2 Authorization Code / PKCE 与用户级授权绑定。
- V2：mTLS、签名鉴权、企业 Secret Manager、出站代理和 DNS pinning。
