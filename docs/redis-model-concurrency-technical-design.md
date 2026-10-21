# 模型调用分布式并发隔离技术方案

> 状态：待实施  
> 所属：`model_providers`  
> 前置：[Redis 基础设施](./redis-foundation-technical-design.md)

## 1. 目标

所有 API 和 Worker 的 Chat、Embedding、Rerank 调用必须经过同一个分布式容量入口。解决以下问题：

- 多进程各自计数造成实际并发超过 Provider 配额。
- 离线评估占满模型连接，在线 Chat 无法及时响应。
- SSE 断开或进程崩溃后许可泄漏。
- 多维限制按顺序加锁可能死锁。

## 2. 接入边界

并发控制放在统一调用链：

```text
chat / retrieval / evaluation worker
  -> model_providers.service
  -> DistributedModelCapacityService.acquire()
  -> model_providers.gateway
  -> ProviderClient
```

业务模块不得直接操作 Redis，也不得自行绕过 gateway 调用 SDK。许可覆盖完整远程调用生命周期；流式 Chat 必须持有到 stream 结束、失败或取消。

请求 DTO 增加稳定用途字段：

```ts
type ModelCallPurpose =
  | "online_chat"
  | "workflow_runtime"
  | "evaluation_answer"
  | "evaluation_grader"
  | "embedding";
```

## 3. 初始容量建议

实际值由部署者根据 Provider 配额调整，首发保守值：

| 维度 | 默认上限 |
| --- | ---: |
| 全局模型调用 | 10 |
| 在线 Chat + Workflow | 8 |
| 评估回答 | 1 |
| 评估裁判 | 1 |
| Embedding | 3 |
| 单 Provider | 5 |
| Ollama 本地 Provider | 2 |

在线保留容量不能只靠“总并发减评估并发”隐式实现。每个请求需要同时满足全局、Provider、模型类型和用途四个维度；评估上限独立且低于全局。

## 4. Redis 数据结构

每个维度用 ZSET 保存许可租约：

```text
key: {prefix}:semaphore:{dimension}:{id}
member: permitId
score: leaseExpiresAtMs
```

等待队列同样用 ZSET：

```text
key: {prefix}:semaphore:wait:{dimension}:{id}
member: ticketId
score: enqueueSequence
```

一次调用涉及的所有维度必须在同一个 Lua 脚本内原子检查和获取：

1. 清理所有维度中过期租约。
2. 检查 ticket 是否处于各维度可运行的队首范围。
3. 检查各维度当前数量是否低于上限。
4. 全部满足时写入同一个 `permitId` 并移除 ticket。
5. 任一维度不满足时不修改许可集合。

禁止按“全局 -> Provider -> 用途”逐个加锁，否则并发请求会持有部分许可并互相等待。

## 5. 许可生命周期

```text
enqueue ticket
  -> 等待（可取消、可超时）
  -> 原子 acquire
  -> 每 lease/3 周期续租
  -> 远程调用完成/失败/取消
  -> 原子 release
```

- 默认租约 30 秒，持有期间每 10 秒续租。
- 等待默认 10 秒；超时返回 `MODEL_CAPACITY_TIMEOUT`，映射为 503 和可重试提示。
- `AbortSignal` 触发时立即移除 ticket 或释放 permit。
- 进程崩溃后无需显式解锁，租约到期自动回收。
- release 与 renew 必须校验 `permitId`，不能释放其他请求的许可。
- Redis 时间应由 Lua `TIME` 获取，避免不同宿主机时钟偏差。

## 6. 公平性与优先级

同一用途内使用 FIFO ticket。不同用途不共享一个等待队列，以保证在线流量不会排在大量评估任务之后。

首版不实现任意数字优先级。固定用途比开放式 priority 更可解释，也避免长期饿死。评估任务慢速推进由自身并发上限控制，在线请求仍受全局和 Provider 上限保护。

## 7. Redis 故障行为

- 新请求无法获取许可时 fail closed，返回 `MODEL_CAPACITY_CONTROL_UNAVAILABLE`。
- 已持有许可但续租失败时，立即取消尚未开始输出的请求；流式已经输出 token 时结束 stream 并记录明确错误，不能自动切换 Provider。
- 不默认回退本地内存 semaphore，否则多实例会突破供应商额度。
- 可提供 `MIA_LLM_CAPACITY_EMERGENCY_LOCAL_FALLBACK=false`，只有运维人工开启时生效，并持续输出 critical 告警。

## 8. 配置

```text
MIA_LLM_GLOBAL_CONCURRENCY=10
MIA_LLM_ONLINE_CONCURRENCY=8
MIA_LLM_EVALUATION_ANSWER_CONCURRENCY=1
MIA_LLM_EVALUATION_GRADER_CONCURRENCY=1
MIA_EMBEDDING_CONCURRENCY=3
MIA_LLM_ACQUIRE_TIMEOUT_MS=10000
MIA_LLM_LEASE_MS=30000
MIA_LLM_LEASE_RENEW_MS=10000
```

Provider/模型级 override 仍由 `model_providers` 模块管理，不把业务配置散落到 Redis 模块。配置变更首版通过重启生效，避免不同实例读到不同上限。

## 9. 可观测性

```text
mia_model_capacity_in_use{dimension,id,purpose}
mia_model_capacity_waiting{dimension,id,purpose}
mia_model_capacity_wait_seconds{purpose}
mia_model_capacity_acquire_timeout_total{purpose}
mia_model_capacity_lease_renew_failures_total{purpose}
mia_model_capacity_reclaimed_total{dimension}
```

调用日志增加 `permit_id` 的短哈希、`purpose`、等待时间和命中的限制维度。不得记录 Provider secret 或完整请求内容。

## 10. 测试与验收

- 两个进程并发调用时，全局和 Provider 实际并发均不超限。
- 评估队列持续运行时，在线用途仍能获得保留槽位。
- acquire 多维度原子完成，不出现部分许可残留。
- 等待中的请求取消后立即移出队列。
- 模拟进程 `SIGKILL`，租约到期后容量自动恢复。
- SSE 客户端断开时上游请求取消并释放许可。
- Redis 故障时不会静默绕过容量控制。

