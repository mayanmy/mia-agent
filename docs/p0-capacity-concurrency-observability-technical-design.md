# Mia P0 容量、模型并发与可观测性技术方案

## 1. 文档信息

- 文档状态：待实施
- 优先级：P0
- 方案版本：V1.0
- 更新日期：2026-09-01
- 适用范围：Mia API、Agent Runtime、Model Providers、Chat SSE、Workflow Runtime 与基础运维
- 单服务器落地方案：[Mia 单机保护版 P0 技术方案](./p0-single-node-protection-technical-design.md)

## 2. 背景

Mia 已取消固定用户规模限制。产品可以服务不同规模的团队和组织，但当前后端仍主要按单实例、本地部署方式运行，容量参数分散在代码、模型配置和部署环境中，缺少统一的模型并发治理与基础运行指标。

取消人数限制不等于承诺无限容量。本阶段的目标是让容量做到：

1. 可配置：部署者可以按机器、模型供应商和业务负载调整容量。
2. 可保护：突发流量不会无上限压向模型供应商或耗尽 API 资源。
3. 可取消：用户停止生成或 SSE 断开时，排队和运行中的任务都能释放资源。
4. 可观测：能够回答当前是否拥塞、拥塞在哪里、需要调整哪个参数。
5. 可演进：保持单实例实现简单，同时为后续 Redis、多实例和独立 Worker 留出替换边界。

## 3. 本阶段范围

### 3.1 必须实现

- 统一读取、校验和暴露容量配置。
- 全局 LLM 并发限制。
- Provider 级 LLM 并发限制。
- FIFO 排队、排队超时和取消。
- Chat、Workflow 等模型调用统一经过并发入口。
- 记录 API、SSE、LLM 队列和模型调用的基础指标。
- 健康检查返回非敏感容量摘要。
- Run Trace 记录模型排队和调用耗时。
- 容量配置、队列和指标的单元测试。

### 3.2 明确不做

- 不在 P0 引入 Redis、Kafka、RabbitMQ 或 BullMQ。
- 不在 P0 部署多个 API 副本。
- 不拆分模型网关微服务。
- 不建设完整 Prometheus/Grafana 发布套件。
- 不实现跨实例分布式 semaphore。
- 不实现自动扩缩容。
- 不把文档解析和 Embedding 全面迁移到独立 Worker。

这些能力属于多实例和后台任务扩展阶段。P0 只建立稳定接口，使进程内实现以后可以替换而不修改 Agent Runtime。

## 4. 设计原则

### 4.1 用户规模不是容量参数

系统不配置“最大用户数”。容量由实际并发、请求类型、模型耗时、数据库连接和部署资源决定。

### 4.2 业务模块不直接管理并发

`chat`、`agent_runtime`、`workflow_runtime` 不创建自己的 semaphore，也不判断具体 Provider。所有 Chat 模型调用统一经过 `model_providers` 的执行网关。

### 4.3 排队也必须可取消

请求进入队列后仍必须监听 `AbortSignal`。用户取消时立即移除 waiter，不能等到获得槽位后再发现请求已取消。

### 4.4 配置错误启动即失败

并发数、队列长度和超时出现零、负数、非整数或不合理关系时，API 启动失败，避免运行中静默采用错误值。

### 4.5 先保护系统，再追求吞吐

队列达到上限时快速返回明确的“系统繁忙”，不能无限堆积 Promise 和请求上下文。

## 5. 总体架构

```text
Chat / Workflow / Service API / Widget
                 |
                 v
          Agent Runtime
                 |
                 v
       ModelProvidersService
                 |
                 v
       LlmConcurrencyManager
          |              |
          | 全局槽位      | Provider 槽位
          v              v
      Model Gateway -> Provider Client -> 外部模型
          |
          +-> MetricsService
          +-> Run Trace
```

获取槽位顺序固定为：

```text
检查取消
→ 进入全局队列
→ 获得全局槽位
→ 进入 Provider 队列
→ 获得 Provider 槽位
→ 调用模型
→ 释放 Provider 槽位
→ 释放全局槽位
```

必须使用 `try/finally` 释放槽位。第二阶段获取 Provider 槽位失败时，也必须释放已获得的全局槽位。

## 6. 容量配置

### 6.1 新增配置项

```dotenv
# API 与 SSE
MIA_SSE_MAX_CONNECTIONS=200

# LLM 全局保护
MIA_GLOBAL_LLM_CONCURRENCY=20
MIA_GLOBAL_LLM_QUEUE_SIZE=100
MIA_LLM_QUEUE_TIMEOUT_MS=10000

# Provider 未单独配置时的默认值
MIA_PROVIDER_DEFAULT_CONCURRENCY=10
MIA_PROVIDER_DEFAULT_QUEUE_SIZE=50

# 基础指标
MIA_METRICS_ENABLED=true
MIA_METRICS_PATH=/internal/metrics
MIA_METRICS_INCLUDE_PROCESS=true
```

默认值是单实例初始部署基线，不代表产品人数上限。生产环境需要通过压测和供应商配额调整。

### 6.2 配置模型

在 `AppConfig` 中增加：

```ts
type CapacityConfig = {
  sseMaxConnections: number;
  globalLlmConcurrency: number;
  globalLlmQueueSize: number;
  llmQueueTimeoutMs: number;
  providerDefaultConcurrency: number;
  providerDefaultQueueSize: number;
};

type MetricsConfig = {
  enabled: boolean;
  path: string;
  includeProcessMetrics: boolean;
};
```

`AppConfig` 组合 `capacity` 和 `metrics`。配置只从 `core/config.ts` 读取，业务 Service 不直接访问 `process.env`。

### 6.3 Provider 覆盖

Provider 级配置优先级：

```text
Provider 数据库配置
→ 环境变量默认值
```

建议在 Provider 增加可空字段：

```prisma
llmConcurrency Int? @map("llm_concurrency")
llmQueueSize   Int? @map("llm_queue_size")
```

为空表示继承全局默认值。第一轮如暂不修改数据库，可只使用环境变量默认值，但 `LlmConcurrencyManager` 的接口必须接收 `providerId` 和解析后的限制，避免后续重构调用方。

## 7. LLM 并发管理器

### 7.1 模块位置

建议新增：

```text
backend/src/modules/model-providers/
  concurrency/
    llm-concurrency.manager.ts
    fifo-semaphore.ts
    concurrency.types.ts
```

它属于 `model_providers`，因为并发保护是外部模型调用能力的一部分。Agent Runtime 只调用 `ModelProvidersService`。

### 7.2 接口

```ts
type LlmPermitRequest = {
  providerId: string;
  providerConcurrency: number;
  providerQueueSize: number;
  signal?: AbortSignal;
  requestId: string;
};

type LlmPermit = {
  globalQueueMs: number;
  providerQueueMs: number;
  release(): void;
};

interface LlmConcurrencyManager {
  acquire(request: LlmPermitRequest): Promise<LlmPermit>;
}
```

`release()` 必须幂等，重复调用不改变计数。

### 7.3 队列规则

- 排队策略：FIFO。
- 全局活跃数达到上限后进入全局队列。
- Provider 活跃数达到上限后进入 Provider 队列。
- 任一队列达到长度上限时立即拒绝。
- 排队超过 `MIA_LLM_QUEUE_TIMEOUT_MS` 时失败。
- `AbortSignal` 触发时从队列移除并返回 canceled。
- 不按 Workspace 抢占；后续出现明显资源争用时再增加公平队列。

### 7.4 错误分类

扩展稳定错误码：

```text
model_queue_full
model_queue_timeout
model_canceled
model_rate_limited
model_provider_unavailable
```

HTTP/SSE 映射：

| 场景 | HTTP | Runtime/SSE | 是否重试 |
| --- | --- | --- | --- |
| 队列已满 | 429 | `error: model_queue_full` | 客户端延迟后可重试 |
| 排队超时 | 504 | `error: model_queue_timeout` | 可重试 |
| 用户取消 | 499 语义，不强制返回 HTTP 499 | `canceled` | 不重试 |
| Provider 429 | 429 | `model_rate_limited` | 首 Token 前按策略退避 |
| Provider 不可用 | 503 | `model_provider_unavailable` | 首 Token 前可重试或 fallback |

如果 SSE 已开始输出内容，不允许自动重试或切换模型继续拼接回答。

### 7.5 调用集成

统一在 `ModelProvidersService` 或 Gateway 上层完成：

```ts
const permit = await concurrencyManager.acquire(...);

try {
  return await gateway.streamChatCompletion(...);
} finally {
  permit.release();
}
```

流式调用不能在返回 `AsyncGenerator` 时立即释放。槽位生命周期必须覆盖整个迭代过程，直到：

- 上游正常结束；
- 上游抛错；
- 用户取消；
- 消费方提前停止迭代。

因此建议由包装后的 async generator 在自身 `finally` 中释放 permit。

## 8. SSE 连接保护

新增 `SseConnectionManager`，第一阶段使用进程内原子计数：

```text
建立连接前 acquire
→ 达到 MIA_SSE_MAX_CONNECTIONS 时返回 503
→ 建立心跳和 Runtime
→ close / error / cancel 时 release
```

必须覆盖：

- 工作台 Chat SSE；
- Public Agent SSE；
- Service API 流式接口；
- Widget SSE。

所有 Controller 使用同一个 Service，不能各自维护计数。该能力只保护单实例；未来多实例时由负载均衡容量和共享指标共同控制。

## 9. 基础指标

### 9.1 指标类型

建议使用 Prometheus 文本格式，但 P0 不强制部署 Prometheus Server。API 暴露受限的内部抓取端点。

#### API

```text
mia_http_requests_total{method,route,status}
mia_http_request_duration_seconds{method,route,status}
mia_http_in_flight_requests{route}
```

禁止把用户 ID、Workspace ID、Agent ID、Request ID 放入指标 Label，避免高基数。

#### SSE

```text
mia_sse_connections_active{source}
mia_sse_connections_total{source,status}
mia_sse_connection_duration_seconds{source,status}
mia_sse_rejected_total{source,reason}
```

`source` 只允许有限集合：`internal_chat`、`public_agent`、`service_api`、`widget`。

#### LLM

```text
mia_llm_active{provider}
mia_llm_queue_depth{scope,provider}
mia_llm_queue_wait_seconds{scope,provider,result}
mia_llm_requests_total{provider,model,result}
mia_llm_request_duration_seconds{provider,model,result}
mia_llm_first_token_seconds{provider,model,token_type}
mia_llm_rejected_total{provider,reason}
```

Provider 和 Model Label 使用受控标识或规范化名称；如果模型配置数量可能很大，生产指标只使用 Provider，模型级明细留在 Run Trace。

#### 进程与数据库

```text
process_resident_memory_bytes
nodejs_eventloop_lag_seconds
nodejs_heap_size_used_bytes
mia_database_query_duration_seconds{operation,result}
mia_database_errors_total{operation}
```

P0 不要求在每条 Prisma Query 上打 Label。只覆盖健康检查和高价值业务操作，避免过度埋点。

### 9.2 指标端点安全

- 默认路径：`/internal/metrics`。
- 生产环境只允许内网或反向代理白名单访问。
- 不返回 Secret、Prompt、用户输入、工具参数和业务数据。
- 不挂 Workspace 上下文，不面向普通工作台用户。
- 如果无法保证网络隔离，使用独立的 metrics token，并只比较哈希或常量时间值。

### 9.3 健康接口

现有健康接口增加非敏感摘要：

```json
{
  "status": "ok",
  "capacity": {
    "sseActive": 12,
    "sseLimit": 200,
    "llmActive": 8,
    "llmLimit": 20,
    "llmQueued": 3
  }
}
```

详细 Provider 状态只在鉴权后的运维接口展示，不应暴露在公网匿名健康端点。

## 10. Run Trace

`chat_stream` 模型 Step 增加：

```json
{
  "telemetry": {
    "globalQueueMs": 12,
    "providerQueueMs": 38,
    "modelRequestMs": 2040,
    "firstUpstreamEventMs": 410,
    "firstReasoningTokenMs": null,
    "firstContentTokenMs": 680
  }
}
```

判断规则：

- `globalQueueMs` 高：Mia 全局并发不足或总体流量突增。
- `providerQueueMs` 高：单个 Provider 配额或并发不足。
- 两个 Queue 指标低但首 Token 高：上游模型或网络慢。
- 排队超时：Step 状态为 failed，错误码为 `model_queue_timeout`。
- 排队期间取消：Run 状态为 canceled，不调用上游模型。

Trace 记录实际值，但不记录队列中其他请求的信息。

## 11. 管理页面

P0 可以先在“运行链路”与模型供应商详情展示：

- 当前全局 LLM 活跃数、上限和排队数。
- Provider 当前活跃数、上限和排队数。
- 最近一次请求的全局排队、Provider 排队、首 Token 和总耗时。
- 队列满、排队超时和 Provider 429 的次数。

第一阶段不做复杂大盘。数据来源优先使用当前进程指标和 Run Trace 聚合，避免新建高频业务表。

## 12. 配置热更新

P0 默认采用启动时读取环境变量。环境变量修改后重启 API 生效。

Provider 数据库覆盖允许在保存后生效：

- 新请求使用新上限。
- 已运行请求不强制取消。
- 降低上限时不抢占正在执行的调用，只停止发放新 permit，直到活跃数回落。
- 增加上限后立即 drain FIFO 队列。

## 13. 失败与降级

| 故障 | 行为 |
| --- | --- |
| 指标写入失败 | 不影响模型调用，记录受限应用日志 |
| Run Trace 写入失败 | 不影响已开始的回答 |
| 队列内部状态异常 | 拒绝新调用并记录错误，禁止绕过并发保护 |
| Provider 配置不存在 | 不进入队列，直接返回配置错误 |
| 获取全局槽位后 Provider 排队失败 | 释放全局槽位 |
| SSE 客户端断开 | 取消排队或上游请求，并释放所有槽位 |
| API 优雅停机 | 停止接收新请求，等待有限时间后取消剩余运行 |

## 14. 安全约束

- 指标 Label 不包含用户输入、邮箱、API Key、Authorization、Cookie、Prompt 或工具参数。
- 队列诊断 API 不返回等待请求列表。
- 日志只记录 request ID、run ID、Provider/Model 标识、耗时和错误分类。
- 健康检查不返回数据库连接串、Provider Base URL 或 Secret 状态细节。
- Provider 限制只能由有模型管理权限的空间 Owner/Manager 修改。

## 15. 代码改造清单

### 15.1 后端

```text
backend/src/core/config.ts
  - CapacityConfig / MetricsConfig
  - 环境变量解析与启动校验

backend/src/modules/model-providers/
  - LlmConcurrencyManager
  - FifoSemaphore
  - 模型流包装与 permit 生命周期
  - Provider 并发覆盖配置

backend/src/modules/chat/
  - 统一 SseConnectionManager
  - 连接拒绝、取消和指标

backend/src/modules/external_access/
  - 复用 SseConnectionManager

backend/src/modules/agent_runtime/
  - queue telemetry 写入 chat_stream Step

backend/src/modules/metrics/
  - MetricsModule
  - MetricsService
  - 内部 metrics controller
```

如果 `metrics` 只承担技术指标，可作为基础设施模块，不读取 Agent、Chat、Workspace 等业务表。

### 15.2 数据库

第一阶段可不增加业务指标表。如允许 Provider 覆盖并发限制，则增加：

```text
model_providers.llm_concurrency
model_providers.llm_queue_size
```

迁移字段允许为空，旧 Provider 自动继承环境默认值。

### 15.3 部署

更新：

- `.env.docker.example`
- `docker-compose.backend.yml`
- 生产部署脚本清单
- 宝塔 Nginx 部署指南

注意：当前 `deploy.sh` 只部署后端，并会通过 `deploy-backend.sh` 自动执行 Prisma migration。前端如有管理页面改动，需要额外执行 `deploy-frontend.sh`。

## 16. 测试方案

### 16.1 配置测试

- 默认值正确。
- 非整数、零、负数启动失败。
- Queue Size 小于零失败，允许配置为零表示不排队、直接拒绝。
- Provider 空值继承默认配置。

### 16.2 Semaphore 单元测试

- 不超过全局并发数。
- 不超过 Provider 并发数。
- FIFO 顺序稳定。
- 队列满立即拒绝。
- 排队超时移除 waiter。
- 排队取消移除 waiter。
- 执行异常释放槽位。
- 流式消费者提前结束仍释放槽位。
- Provider 获取失败释放全局槽位。
- `release()` 重复调用不产生负数。

### 16.3 集成测试

- Chat、Workflow 和 Service API 共享全局上限。
- 不同 Provider 分别受独立上限约束。
- SSE 断开能取消排队和上游调用。
- Run Trace 正确记录两级排队耗时。
- 指标计数与执行结果一致。
- 指标端点不包含敏感内容和高基数 ID。

### 16.4 容量验证

至少覆盖：

```text
普通 API：20 / 50 / 100 并发
SSE：30 / 50 / 100 / 200 长连接
LLM：并发上限内、队列内、队列满三组场景
Workflow：包含 1 个和多个 LLM 节点
取消：排队中取消、首 Token 前取消、输出中取消
```

验收不以“支持多少用户”表示，而以给定资源下的 QPS、并发连接、错误率、P95/P99 和资源占用表示。

## 17. 实施顺序

### 阶段 A：配置与基础抽象

1. 增加容量配置和校验。
2. 实现 FIFO semaphore。
3. 实现 `LlmConcurrencyManager`。
4. 补单元测试。

### 阶段 B：模型调用接入

1. Chat 流式模型调用接入两级 permit。
2. 非流式模型调用接入。
3. Workflow LLM 节点接入。
4. 接通取消和稳定错误码。

### 阶段 C：SSE 与指标

1. 增加统一 SSE 连接计数。
2. 增加 MetricsModule。
3. 暴露受限指标端点。
4. Run Trace 增加排队遥测。

### 阶段 D：运维与验收

1. 更新环境变量和部署文档。
2. 增加最小管理视图。
3. 执行容量测试。
4. 根据结果调整默认值并形成容量基线报告。

## 18. 验收标准

P0 完成必须同时满足：

1. 所有 Chat 模型调用受全局和 Provider 两级并发限制。
2. 队列有长度上限，不会无限累积。
3. 排队超时和队列已满返回稳定、可识别错误。
4. 用户取消和 SSE 断开能移除 waiter、取消上游并释放槽位。
5. Chat、Workflow、Widget 和 Service API 不绕过统一模型入口。
6. Run Trace 可以区分 Mia 排队、Provider 排队和上游首 Token 延迟。
7. 运维端可以看到 SSE、LLM 活跃数、排队数、耗时和拒绝次数。
8. 指标和日志不包含 Secret、Prompt 或用户输入。
9. 默认配置兼容当前单实例部署，不要求引入 Redis。
10. 配置、并发、取消、异常释放和指标均有自动化测试。

## 19. 后续演进边界

达到以下任一条件后进入多实例改造：

- 单实例 CPU、内存或事件循环持续接近容量上限。
- SSE 连接数超过单实例安全阈值。
- 需要滚动发布期间保持流恢复和审批状态。
- 单机故障不再满足可用性要求。
- 模型并发、公平性或队列需要跨节点统一。

后续替换路径：

```text
进程内 LlmConcurrencyManager -> Redis/独立模型网关
进程内 SSE 状态             -> Redis Stream/共享事件存储
进程内 Rate Limiter          -> Redis 原子限流
API 内后台任务               -> 持久化任务队列 + Worker
本地知识文件                 -> MinIO/S3
单 API 容器                  -> 多副本 + 负载均衡
```

P0 的 DTO、错误码、指标名和调用边界应保持稳定，使上述替换主要发生在基础设施实现层，而不是重新修改 Agent Runtime。
