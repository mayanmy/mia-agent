# 外部接口 Redis 限流技术方案

> 状态：待实施  
> 所属：`external_access`  
> 前置：[Redis 基础设施](./redis-foundation-technical-design.md)

## 1. 现状与目标

当前 `ExternalRateLimiterService` 使用进程内 `Map`。它会在重启后清空，并且多个 API 实例各自计数，无法形成真实的外部访问保护。

首版用 Redis Lua 令牌桶替换内存实现，覆盖匿名 Widget、外部 API key 和外部会话消息接口。内部管理后台不纳入本方案，避免误伤管理员操作。

## 2. 限流维度

一次请求可以同时检查多个 bucket：

| scope | subject | 目的 |
| --- | --- | --- |
| `external-ip` | 客户端 IP 的 HMAC | 抑制匿名来源突发请求 |
| `external-api-key` | API key ID，不是密钥原文 | 控制单个集成额度 |
| `widget-token` | Widget access token 的稳定 ID | 控制嵌入入口 |
| `external-agent` | Agent ID | 防止单 Agent 被集中打满 |
| `external-session` | 外部 session ID | 抑制单会话刷消息 |

key 格式：

```text
{prefix}:rate-limit:{scope}:{subjectHash}
```

IP、token 等输入使用 `HMAC-SHA256(MIA_RATE_LIMIT_HASH_SECRET, value)` 后截断存入 key。普通 SHA-256 不能防止低熵 IP 被字典反查。

## 3. 算法

采用 Redis Lua 原子令牌桶，每个 bucket 保存：

```text
tokens
lastRefillAtMs
```

脚本流程：

1. 使用 Redis `TIME` 获取当前时间。
2. 按 `ratePerMs` 补充令牌，不超过 `capacity`。
3. 令牌足够则扣减并允许请求。
4. 不足则返回剩余量、重试等待时间和重置时间。
5. 设置足以覆盖桶完全恢复时间的 TTL。

多个 bucket 必须在一次 Lua 调用中全部检查后再扣减，避免 IP bucket 已扣减但 Agent bucket 拒绝的部分提交。

令牌桶允许受控突发，比固定窗口在边界处双倍放量更稳定。首版每次请求消耗 1 token，不做按 token 数或模型成本加权。

## 4. 默认策略

建议初始值，最终应通过压测调整：

| 路由组 | 容量 | 持续速率 |
| --- | ---: | ---: |
| 创建外部会话 | 10 | 10/min/IP |
| Widget 发送消息 | 6 | 6/min/session |
| 外部 API 发送消息 | 30 | 30/min/API key |
| 单 Agent 外部消息 | 60 | 60/min/Agent |

路由到策略的映射在代码中使用稳定策略名，不允许 Controller 临时传任意数字：

```ts
type ExternalRateLimitPolicy =
  | "external_session_create"
  | "widget_message_send"
  | "external_api_message_send";
```

Controller 仍只负责提取当前访问主体并调用 service；策略组合、HMAC 和 Redis 脚本调用都在 `ExternalRateLimiterService`。

## 5. 客户端 IP 与代理

- 默认只信任直连 socket 地址。
- 只有显式配置可信反向代理后才读取 `X-Forwarded-For`。
- 不得直接信任客户端自报的首个 IP。
- IPv6 地址先规范化，再做 HMAC。
- 增加 `MIA_TRUST_PROXY_HOPS` 或可信 CIDR 配置，并在生产部署检查项中验证。

## 6. 响应约定

允许请求时返回：

```text
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
```

拒绝时返回 HTTP 429，并额外提供：

```text
Retry-After
```

响应体沿用 Mia 统一错误模型：

```json
{
  "code": "EXTERNAL_RATE_LIMITED",
  "message": "请求过于频繁，请稍后重试",
  "requestId": "..."
}
```

不得在响应中暴露 bucket key、IP 哈希、API key ID 或内部 Redis 错误。

## 7. 故障策略

公网外部接口采用 fail closed：Redis 超时或不可用时返回 HTTP 503，错误码 `RATE_LIMIT_SERVICE_UNAVAILABLE`。不能回退到本地 `Map`，否则多个实例会绕过总额度。

Redis 命令超时目标不超过 100 毫秒；整条限流判断设置硬超时，避免 Redis 故障拖住 SSE 建连。连续故障需要触发告警，但不能由限流 service 自行熔断成放行。

## 8. 迁移方式

1. 保留现有 service 接口，新增 Redis 实现，避免 Controller 大改。
2. 用 `MIA_EXTERNAL_REDIS_RATE_LIMIT_ENABLED` 控制实现选择。
3. 预发布环境开两个 API 实例，对同一 subject 交替请求验证共享额度。
4. 生产先观察 shadow 结果：计算 Redis 判定但仍以旧逻辑放行，不写双重扣减。
5. 确认误拒绝率和 Redis 延迟后切换为 enforce。
6. 稳定后删除进程内 `Map` 实现，feature flag 仅保留紧急关闭入口；关闭时外部接口整体返回维护状态，而不是无限放行。

## 9. 可观测性

```text
mia_external_rate_limit_requests_total{policy,result}
mia_external_rate_limit_rejected_total{policy,scope}
mia_external_rate_limit_redis_duration_ms{policy}
mia_external_rate_limit_errors_total{policy,code}
```

日志记录 `request_id`、`policy`、`scope`、subject 短哈希、remaining 和 retry_after，不记录原始 IP/token/API key。

## 10. 测试与验收

- Lua 单元/集成测试覆盖首次请求、补充、耗尽、TTL 和时间边界。
- 多 bucket 判断必须全成功才扣减，失败时所有 bucket 数值不变。
- 两个 API 实例交替请求共享同一额度。
- 并发压测下允许数不超过容量与补充速率误差范围。
- Redis 不可用时外部接口返回 503，不能无限放行。
- 可信代理与伪造 `X-Forwarded-For` 场景均有测试。
- 响应头、错误码和 `Retry-After` 可被 Widget/外部客户端正确处理。

