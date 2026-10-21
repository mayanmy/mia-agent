# Redis 基础设施技术方案

> 状态：待实施  
> 所属：`core` 基础设施能力  
> 前置：无

## 1. 目标与边界

提供统一 Redis 连接、key 命名、Lua 脚本、健康检查和生命周期管理，供评估队列、模型并发与外部限流使用。

Redis 不是 Mia 的业务事实存储。数据库记录、权限、评估结果和配置仍以 PostgreSQL 为准。业务模块不能直接依赖 `ioredis`，只能依赖本模块导出的窄接口。

## 2. 依赖选择

```json
{
  "dependencies": {
    "bullmq": "固定到经过验证的版本",
    "ioredis": "固定到经过验证的版本"
  }
}
```

不引入 `@nestjs/bullmq`。Mia 当前只需要一个明确的评估队列，直接封装 BullMQ 能减少隐式全局注册，也更方便让 API 与 Worker 使用不同模块入口。

## 3. 代码结构

```text
backend/src/modules/redis/
  redis.module.ts
  redis.service.ts
  redis-key.factory.ts
  redis-health.service.ts
  redis-scripts.service.ts
  scripts/
    acquire-semaphore.lua
    renew-semaphore.lua
    release-semaphore.lua
    consume-token.lua
```

职责：

- `RedisService`：管理普通命令连接，并按用途创建独立连接。
- `RedisKeyFactory`：生成带环境前缀的 key，禁止业务代码手写前缀。
- `RedisScriptsService`：加载并以 SHA 调用 Lua，遇到 `NOSCRIPT` 时重新注册。
- `RedisHealthService`：执行超时受控的 `PING`，供 readiness 和指标使用。
- BullMQ 创建自己的连接；Pub/Sub 使用独立订阅连接，不能与普通命令复用。

## 4. 配置

在 `backend/src/core/config.ts` 增加类型化配置并在启动时校验：

```text
MIA_REDIS_URL=redis://redis:6379/0
MIA_REDIS_PREFIX=mia:production
MIA_REDIS_REQUIRED=true
MIA_REDIS_CONNECT_TIMEOUT_MS=5000
MIA_REDIS_COMMAND_TIMEOUT_MS=2000
MIA_REDIS_MAX_RETRIES_PER_REQUEST=2
```

约束：

- `MIA_REDIS_PREFIX` 必须包含环境，不同环境不得共享前缀。
- 生产密码只通过 secret/env 注入，不写入 Compose 或日志。
- URL 日志必须脱敏用户名、密码和查询参数。
- 远程 Redis 应使用 `rediss://`；本机 Compose 依赖隔离网络，不暴露宿主机端口。
- BullMQ 连接使用 `maxRetriesPerRequest: null`；普通 API 命令使用有限重试，避免请求无限挂起。

## 5. Key 规范

```text
{prefix}:queue:evaluation:*
{prefix}:semaphore:{dimension}:{id}
{prefix}:semaphore:wait:{dimension}:{id}
{prefix}:rate-limit:{scope}:{subjectHash}
{prefix}:events:evaluation-cancel
```

- key 只包含稳定 ID 或不可逆 HMAC，不包含邮箱、IP 明文、API key、Prompt、问题或文档内容。
- 所有临时 key 必须有 TTL；BullMQ 自有 key 按队列清理策略管理。
- 禁止在请求路径执行 `KEYS`；运维扫描使用 `SCAN`。
- 不允许通过 `FLUSHDB` 清理某一环境，必须按前缀渐进扫描并人工确认。

## 6. Docker Compose

在 `docker-compose.backend.yml` 增加：

```yaml
redis:
  image: redis:7.4-alpine
  restart: unless-stopped
  command:
    - redis-server
    - --appendonly
    - "yes"
    - --appendfsync
    - everysec
    - --maxmemory-policy
    - noeviction
  volumes:
    - mia_redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 5
```

`api` 和 `evaluation-worker` 依赖 Redis 健康，并通过 `MIA_REDIS_URL=redis://redis:6379/0` 连接。生产环境不映射 `6379` 到宿主机。

选择 `noeviction` 是因为队列和信号量不能被缓存淘汰策略随机删除。容量不足时让写入明确失败并告警，比静默丢任务更安全。

## 7. 健康检查

现有 `/api/v1/health` 只有数据库状态，需要拆成：

- `/health/live`：只证明 Node 进程事件循环仍可响应，不访问外部依赖。
- `/health/ready`：检查 PostgreSQL、Redis；启用 Worker 后还要检查最近 Worker heartbeat。
- 保留 `/health` 作为兼容入口，返回聚合状态。

建议响应：

```json
{
  "status": "degraded",
  "database": "ok",
  "redis": "unavailable",
  "evaluationWorker": "unknown"
}
```

健康接口不得泄露 Redis 地址、账号或异常堆栈。

## 8. 连接与关闭

- API 启动时建立普通连接；`MIA_REDIS_REQUIRED=true` 且首次连接失败时 readiness 保持失败。
- Redis 重连使用有限指数退避和 jitter，不允许紧密重试循环。
- `SIGTERM` 时先停止接收新请求/任务，再关闭 BullMQ Worker、Pub/Sub，最后 `quit()` 普通连接。
- 每个进程复用连接，不为每次请求新建连接。

## 9. 可观测性

至少暴露：

```text
mia_redis_up
mia_redis_command_duration_ms{command}
mia_redis_command_errors_total{command,code}
mia_redis_reconnects_total
```

日志字段包含 `request_id`、`component`、`operation`、`elapsed_ms` 和脱敏后的错误类型，不记录命令参数原文。

## 10. 测试与验收

- 配置解析测试：非法 URL、非法超时、生产缺少 URL。
- key factory 测试：环境隔离、敏感字符串不得进入 key。
- integration 测试：脚本注册、`NOSCRIPT` 恢复、连接重建。
- Compose 验证：Redis 重启后 AOF 恢复 BullMQ 待处理任务。
- 故障注入：Redis 停止时 readiness 失败，API 请求在命令超时内返回而不是悬挂。

