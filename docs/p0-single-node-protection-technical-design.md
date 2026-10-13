# Mia 单机保护版 P0 技术方案

## 1. 文档信息

- 文档状态：待实施
- 优先级：P0
- 方案版本：V1.0
- 更新日期：2026-09-01
- 部署形态：单台服务器、单个 Mia API 实例，Web、PostgreSQL 可与 API 同机部署
- 上位方案：[容量、模型并发与可观测性技术方案](./p0-capacity-concurrency-observability-technical-design.md)

## 2. 背景与目标

Mia 不再限定固定用户规模，但当前生产资源可能只有一台服务器。此时最重要的不是横向扩容，而是保证有限 CPU、内存、数据库连接、网络连接和模型配额不会被突发流量、慢请求或失效连接耗尽。

本方案目标是：

> 通过有界并发、有界排队、及时取消和过载拒绝，让 Mia 在高负载下变慢但不崩溃，并能解释瓶颈发生在哪里。

系统不配置“最大用户数”。验收以并发连接、吞吐、延迟、错误率和资源水位为准。

## 3. 范围

### 3.1 必须实现

1. 全局和 Provider 两级 LLM 并发限制。
2. FIFO 有界队列、排队超时和取消。
3. 所有 SSE 入口共享连接上限。
4. 高内存或 Event Loop Lag 时拒绝新重任务。
5. 公开访问限流状态定期清理并限制内存占用。
6. 文档解析、Embedding 使用独立并发限制。
7. 健康摘要、最小指标和 Run Trace 排队遥测。
8. 优雅停机时停止接收新请求并释放资源。
9. 所有容量参数通过环境变量配置并在启动时校验。

### 3.2 不做

- Redis、Kafka、RabbitMQ、BullMQ。
- API 多副本、Kubernetes 和自动扩缩容。
- 分布式 semaphore、分布式锁和独立模型网关。
- 强制部署 Prometheus/Grafana。
- MinIO/S3 和零停机发布。

上述能力留到单机资源或可用性边界真正出现后实施。

## 4. 总体架构

```text
浏览器 / Widget / Service API
              |
              v
       Nginx（连接与请求保护）
              |
              v
       Mia API 单实例
         |    |    |
         |    |    +-- 指标与资源水位
         |    +------- SSE 连接保护器
         +------------ LLM 两级并发队列
              |
              +-- PostgreSQL + pgvector
              +-- 本地知识文件
              +-- 外部或本地模型服务
```

请求保护顺序固定为：

```text
认证与基础校验
→ 单机过载门禁
→ SSE 连接槽位
→ 全局 LLM 槽位
→ Provider LLM 槽位
→ 模型调用
→ finally 释放全部资源
```

应在加载大附件、查询大量历史和构造完整 Prompt 之前完成过载判断。

## 5. 推荐初始配置

### 5.1 模型使用外部 API

```dotenv
MIA_SSE_MAX_CONNECTIONS=50
MIA_GLOBAL_LLM_CONCURRENCY=5
MIA_GLOBAL_LLM_QUEUE_SIZE=20
MIA_LLM_QUEUE_TIMEOUT_MS=10000
MIA_PROVIDER_DEFAULT_CONCURRENCY=3
MIA_PROVIDER_DEFAULT_QUEUE_SIZE=10

MIA_OVERLOAD_PROTECTION_ENABLED=true
MIA_MEMORY_HIGH_WATERMARK_PERCENT=85
MIA_EVENT_LOOP_LAG_HIGH_MS=250
MIA_OVERLOAD_RECOVERY_SECONDS=10
MIA_SHUTDOWN_GRACE_MS=30000

MIA_DOCUMENT_PARSE_CONCURRENCY=1
MIA_EMBEDDING_CONCURRENCY=2

MIA_METRICS_ENABLED=true
MIA_METRICS_PATH=/internal/metrics
```

### 5.2 模型与 Mia 同机运行

```dotenv
MIA_SSE_MAX_CONNECTIONS=30
MIA_GLOBAL_LLM_CONCURRENCY=2
MIA_GLOBAL_LLM_QUEUE_SIZE=10
MIA_LLM_QUEUE_TIMEOUT_MS=15000
MIA_PROVIDER_DEFAULT_CONCURRENCY=1
MIA_PROVIDER_DEFAULT_QUEUE_SIZE=5
MIA_DOCUMENT_PARSE_CONCURRENCY=1
MIA_EMBEDDING_CONCURRENCY=1
MIA_MEMORY_HIGH_WATERMARK_PERCENT=80
MIA_EVENT_LOOP_LAG_HIGH_MS=200
```

本地推理通常先受 GPU 显存或 CPU 吞吐限制，必须从保守值开始压测，不能照搬外部模型配置。

### 5.3 校验规则

- 并发数必须为大于零的整数。
- Queue Size 可以为零，表示不排队、槽位满时立即拒绝。
- 排队和停机超时必须大于零。
- 内存高水位只允许 `60-95`。
- 配置错误时 API 启动失败。
- 环境变量修改后重启 API 生效。

在 `backend/src/core/config.ts` 增加统一 `SingleNodeCapacityConfig`，业务模块不得直接读取 `process.env`。

## 6. LLM 两级并发保护

### 6.1 设计

全局限制保护整台服务器，Provider 限制保护单个供应商及其配额。例如全局上限为 5，Provider A 为 3、Provider B 为 2，则任何时刻总调用不超过 5，A 自身不超过 3。

建议新增：

```text
backend/src/modules/model-providers/concurrency/
  fifo-semaphore.ts
  llm-concurrency.manager.ts
  concurrency.types.ts
```

接口：

```ts
type PermitRequest = {
  requestId: string;
  providerId: string;
  providerConcurrency: number;
  providerQueueSize: number;
  signal?: AbortSignal;
};

type Permit = {
  globalQueueMs: number;
  providerQueueMs: number;
  release(): void;
};
```

### 6.2 获取与释放

```text
检查 AbortSignal
→ 获取全局 permit
→ 获取 Provider permit
→ 调用模型
→ 释放 Provider permit
→ 释放全局 permit
```

- 获取 Provider permit 失败时必须释放全局 permit。
- `release()` 必须幂等。
- 所有释放必须放在 `finally`。
- waiter 只保存必要 ID、时间与回调，不持有完整 Prompt、附件或历史消息。

### 6.3 流式调用

模型返回 async generator 后不能立即释放 permit。槽位必须覆盖整个流生命周期：

```ts
async function* protectedStream() {
  const permit = await manager.acquire(request);

  try {
    yield* providerStream;
  } finally {
    permit.release();
  }
}
```

正常结束、Provider 报错、用户停止、SSE 断开、消费者提前 `return()` 和优雅停机都必须释放。

### 6.4 队列规则

- FIFO 发放槽位。
- 队列满时立即拒绝，不无限积压 Promise。
- 排队超时后删除 waiter。
- `AbortSignal` 触发后立即删除 waiter。
- 第一阶段不做 Workspace 优先级和抢占。

### 6.5 错误语义

| 错误码 | 场景 | 用户提示 |
| --- | --- | --- |
| `model_queue_full` | 队列已满 | 当前请求较多，请稍后重试 |
| `model_queue_timeout` | 排队超时 | 等待模型超时，请稍后重试 |
| `model_canceled` | 排队或运行期间取消 | 已停止生成 |
| `model_rate_limited` | Provider 返回 429 | 模型服务繁忙，请稍后重试 |
| `server_overloaded` | 单机资源过载 | 服务器繁忙，请稍后重试 |

SSE 已经输出内容后，不允许自动重试或切换模型继续拼接回答。

## 7. SSE 连接保护

新增统一 `SseConnectionManager`，以下入口共享同一个进程内计数器：

- 工作台 Chat。
- Public Agent。
- Widget。
- Service API 流式调用。

生命周期：

```text
通过鉴权
→ acquire SSE permit
→ 写 SSE Header
→ 启动心跳和 Runtime
→ close/error/cancel/finally
→ 清除心跳
→ release permit
```

达到上限时，应在创建完整 Runtime 前返回 503。连接 permit 的 `release()` 同样必须幂等。

Nginx 保持：

```nginx
proxy_buffering off;
proxy_cache off;
gzip off;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
```

Nginx 可以设置连接保护，但应用层应以登录用户、API Key、Agent Token 等可信标识为主要维度，避免公司统一出口 IP 导致误伤。

## 8. 单机过载门禁

### 8.1 监测指标

第一阶段只使用两个低成本信号：

1. Node.js 进程内存水位。
2. Node.js Event Loop Lag。

不单独按瞬时 CPU 拒绝请求，避免短暂波动导致错误降级。

### 8.2 状态机

```text
NORMAL
  → 连续两个采样周期超过高水位
OVERLOADED
  → 连续低于恢复水位指定时间
NORMAL

任意状态
  → 收到停机信号
DRAINING
```

默认滞回：

- 内存进入 85%，恢复 75%。
- Event Loop Lag 进入 250ms，恢复 100ms。
- 恢复需要持续 `MIA_OVERLOAD_RECOVERY_SECONDS`。

### 8.3 过载策略

继续允许：

- Liveness、Readiness 和 Metrics。
- 登录态刷新与退出。
- 正在运行请求的取消。
- 管理员只读诊断接口。

拒绝新建：

- Chat/LLM Run。
- Workflow Run。
- 大文件上传。
- 文档重建索引。
- MCP 手动全量同步。

过载门禁只拒绝新重任务，不强制终止正在执行且接近完成的任务。

## 9. 公开访问限流

当前 `ExternalRateLimiterService` 使用进程内 Map，单实例可以继续使用，但必须增加：

- 定期清除过期窗口。
- Map 最大条目数。
- API Key、发布 Token、外部用户和 IP 的组合维度。
- 只保存标识哈希，不保存原始敏感值。
- 拒绝次数指标。

未来多实例时保持 Service 接口不变，只替换为共享存储实现。

## 10. 数据库保护

PostgreSQL 与 API 同机时必须限制连接占用：

- 明确 Prisma 连接池上限和获取连接超时。
- 保留列表最大分页限制。
- Run Trace、请求日志写入失败不能阻断已经开始的回答。
- 日志和输出 Preview 必须截断。
- 健康检查区分 API 存活与数据库可用。

连接串示例：

```dotenv
DATABASE_URL=postgresql://mia:***@postgres:5432/mia?connection_limit=10&pool_timeout=10
```

最终值需根据 PostgreSQL `max_connections` 和服务器内存压测确认。

## 11. 文档与 Embedding 保护

P0 不引入独立消息队列，但文档解析和 Embedding 必须有独立有界并发：

- 文档解析默认并发 1。
- Embedding 默认并发 2；同机模型建议 1。
- 服务器过载时暂停领取新任务。
- 不在数据库事务中途强制终止任务。
- 同一文档不能并发运行多个索引任务。
- 任务状态和错误持久化，重启后允许人工重试。

## 12. 最小可观测性

### 12.1 运维健康摘要

鉴权后的运维接口返回：

```json
{
  "status": "ok",
  "overloadState": "NORMAL",
  "capacity": {
    "sseActive": 12,
    "sseLimit": 50,
    "llmActive": 3,
    "llmLimit": 5,
    "llmQueued": 4,
    "memoryPercent": 62,
    "eventLoopLagMs": 18
  }
}
```

公网健康端点只返回总体状态，不暴露详细容量。

### 12.2 最小指标

```text
mia_sse_connections_active{source}
mia_sse_rejected_total{source,reason}
mia_llm_active{provider}
mia_llm_queue_depth{scope,provider}
mia_llm_queue_wait_seconds{scope,provider,result}
mia_llm_requests_total{provider,result}
mia_llm_first_content_token_seconds{provider}
mia_llm_rejected_total{provider,reason}
mia_overload_state
mia_overload_rejected_total{operation}
process_resident_memory_bytes
nodejs_eventloop_lag_seconds
```

Label 不允许包含 Workspace ID、Agent ID、User ID、Request ID、Prompt、工具参数或错误原文。

### 12.3 Run Trace

`chat_stream` Step 增加：

```json
{
  "telemetry": {
    "globalQueueMs": 20,
    "providerQueueMs": 35,
    "modelRequestMs": 3100,
    "firstContentTokenMs": 620,
    "overloadStateAtStart": "NORMAL"
  }
}
```

诊断含义：

- 全局排队高：整台 Mia 的模型并发已满。
- Provider 排队高：单个 Provider 配额或并发不足。
- 排队低但首 Token 高：上游模型或网络慢。
- 进入 Runtime 前被拒绝：单机资源过载。

## 13. 优雅停机

部署或重启时：

1. 状态切换为 `DRAINING`。
2. Readiness 表示不再接收新流量。
3. 拒绝新 Chat、Workflow、上传和同步任务。
4. 取消所有仍在排队的 waiter。
5. 最多等待 `MIA_SHUTDOWN_GRACE_MS`。
6. 超时后取消剩余上游请求。
7. 清除心跳、timer 和进程内 Map。
8. 关闭 Prisma 连接并退出。

单实例发布仍会短暂不可用。本阶段只保证安全退出，不解决零停机。

## 14. 安全与内存约束

- Queue waiter 不持有大对象。
- 限流 Map 必须有过期清理和条目上限。
- `AbortSignal` listener 完成后必须移除。
- 所有 timer 在模块销毁时清除。
- 所有 permit 的 `release()` 必须幂等。
- Metrics 不记录输入输出和 Secret。
- Run Trace 只记录截断预览、状态与耗时。
- 不允许通过非法或空配置绕过保护。

## 15. 代码改造清单

### 15.1 新增

```text
backend/src/modules/model-providers/concurrency/fifo-semaphore.ts
backend/src/modules/model-providers/concurrency/llm-concurrency.manager.ts
backend/src/modules/model-providers/concurrency/concurrency.types.ts
backend/src/modules/chat/sse-connection.manager.ts
backend/src/modules/operations/single-node-overload.service.ts
backend/src/modules/metrics/metrics.module.ts
backend/src/modules/metrics/metrics.service.ts
backend/src/modules/metrics/metrics.controller.ts
```

### 15.2 修改

```text
backend/src/core/config.ts
backend/src/modules/model-providers/model-providers.service.ts
backend/src/modules/model-providers/gateway.ts
backend/src/modules/chat/chat.controller.ts
backend/src/modules/external_access/external-access.controller.ts
backend/src/modules/agent_runtime/agent-runtime.service.ts
backend/src/modules/external_access/external-rate-limiter.service.ts
backend/src/main.ts
.env.docker.example
docker-compose.backend.yml
frontend/nginx.conf
```

Chat、Workflow 和 External Access 禁止各自实现 LLM semaphore，必须共用 `model_providers` 的入口。

## 16. 实施阶段

### 阶段 A：配置与 LLM 保护

1. 增加容量配置和启动校验。
2. 实现 FIFO semaphore。
3. 实现两级 LLM 并发管理器。
4. 接入流式、非流式和 Workflow LLM 调用。
5. 补排队、取消和异常释放测试。

### 阶段 B：SSE 与公开限流

1. 增加统一 SSE 连接管理器。
2. 接入所有 SSE Controller。
3. 为限流 Map 增加清理和容量上限。
4. 验证断开和停止生成释放全部资源。

### 阶段 C：过载门禁与指标

1. 实现 Event Loop Lag 和内存采样。
2. 实现 `NORMAL / OVERLOADED / DRAINING`。
3. 增加健康摘要和 Metrics。
4. Run Trace 增加排队遥测。

### 阶段 D：部署与压测

1. 更新环境变量、Compose 和部署文档。
2. 设置数据库连接池参数。
3. 更新 Nginx SSE 与上传限制。
4. 执行单机容量测试。
5. 根据服务器实际资源固化生产基线。

## 17. 测试方案

### 17.1 单元测试

- FIFO 顺序。
- 全局和 Provider 并发上限。
- Queue Size 为零时立即拒绝。
- 队列满、排队超时和排队取消。
- 执行中取消和异常释放。
- `release()` 幂等且计数不为负数。
- SSE 连接计数正确。
- 限流 Map 过期清理。
- 过载状态滞回与恢复。

### 17.2 集成测试

- Chat、Workflow、Widget 和 Service API 共享全局上限。
- 不同 Provider 使用各自上限。
- SSE 断开后活跃数和 LLM 槽位恢复。
- 过载时健康检查可用，新 Chat 被拒绝。
- Run Trace 正确记录排队和首 Token。
- Metrics 不包含敏感或高基数数据。

### 17.3 单机压测矩阵

```text
普通 API：20 / 50 / 100 并发
SSE：10 / 30 / 50 / 80 连接
LLM：并发 2 / 5 / 10
Queue Size：0 / 10 / 20 / 50
取消：排队中取消 50% 请求
首 Token：模拟 1s / 10s / 30s
混合负载：文档索引与 Chat 同时运行
过载：接近内存高水位时继续提交重请求
```

记录成功率、拒绝率、P50/P95/P99、首 Token、总耗时、队列等待、CPU、内存、Event Loop Lag、数据库连接、SSE 活跃数和取消后的资源释放时间。

## 18. 验收标准

1. 所有 Chat 模型调用经过统一的全局和 Provider 并发保护。
2. 队列有明确上限，不会无限增长。
3. 队列满、排队超时和服务器过载具有稳定错误码。
4. 用户取消和 SSE 断开能释放 waiter、上游请求和槽位。
5. 所有 SSE 入口共享连接上限。
6. 公开限流 Map 可清理过期项并限制最大条目数。
7. 持续高内存或 Event Loop Lag 时停止接收新重任务。
8. 健康检查、取消和只读诊断在过载时仍可用。
9. Run Trace 能区分排队、首 Token 和模型执行耗时。
10. 部署者能通过环境变量安全调整容量。
11. 压测期间不发生 OOM、槽位泄漏和无限排队。
12. 不依赖 Redis、多副本、消息队列或外部监控系统即可运行。

## 19. 后续升级触发条件

出现以下任一情况后再进入多实例方案：

- 单机长期处于 CPU、内存或 Event Loop 高水位。
- SSE 安全连接上限无法满足峰值。
- 单实例发布的短暂不可用不能接受。
- 需要跨节点共享流恢复、审批和限流状态。
- 文档任务长期挤占 Chat 资源。
- 本地磁盘、备份窗口或故障恢复时间不可接受。

届时再引入 Redis、持久化任务队列、对象存储、API 多副本和负载均衡。单机 P0 的配置 DTO、错误码、指标名与调用边界保持稳定，基础设施替换不应要求重写 Agent Runtime。
