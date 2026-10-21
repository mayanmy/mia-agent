# Mia Redis 第一优先级接入总览

> 状态：待实施  
> 日期：2026-09-22  
> 目标：只引入能解决后台任务隔离、多实例模型并发和公网限流问题的 Redis 能力，不把 Redis 泛化成业务数据库或全量缓存层。

## 1. 结论

第一阶段接入以下四项能力，并拆成独立方案实施：

1. [Redis 基础设施与运行规范](./redis-foundation-technical-design.md)
2. [RAG 评估 BullMQ 独立 Worker](./redis-evaluation-worker-technical-design.md)
3. [模型调用分布式并发隔离](./redis-model-concurrency-technical-design.md)
4. [外部接口分布式限流](./redis-external-rate-limit-technical-design.md)

推荐依赖采用 `bullmq` + `ioredis`。Redis 客户端由基础设施模块统一创建，业务模块不直接拼 key、不直接调用第三方客户端。

## 2. 为什么是这三类业务能力

| 优先级 | 能力 | 当前问题 | Redis 价值 |
| --- | --- | --- | --- |
| P1-1 | RAG 评估任务 | API 进程内 `setImmediate` 执行，重启丢调度，评估与在线请求争用资源 | BullMQ 持久队列、独立 Worker、重试和并发控制 |
| P1-2 | 模型调用并发 | 单实例内限制无法约束多个 API/Worker 的总调用量 | 原子租约信号量统一限制全局、Provider 和用途配额 |
| P1-3 | 外部接口限流 | 当前 `Map` 限流仅对单进程有效，重启清空 | Redis 原子令牌桶保证多实例一致 |

评估 Worker 必须接入模型并发隔离，否则只是把压力从 API 进程移到另一个进程，仍可能挤占在线聊天。

## 3. 本阶段不接入的模块

- Agent、模型配置、用户权限缓存：先保持 PostgreSQL 为唯一读取来源，避免引入缓存一致性问题。
- 最终 LLM 回答缓存：不同上下文与权限下误命中的风险高。
- SSE 消息和断线续传状态：现有连接仍由单个 API 实例维护，等多实例负载均衡需求明确后再做。
- MCP OAuth token、HTTP 工具 token 和 MCP 本地 semaphore：属于第二阶段；先用模型调用和公网入口验证 Redis 稳定性。
- chunks、embeddings、文件解析结果缓存：向量结果仍以 PostgreSQL/pgvector 为准。
- 通用分布式锁：不提供业务方自由使用的锁服务，避免锁滥用。

## 4. 目标架构

```text
                         +--------------------+
Browser / Widget ------> | API                |
                         | - 创建评估运行      |
                         | - 在线 Chat         |
                         | - 公网接口限流      |
                         +---------+----------+
                                   |
                    +--------------+--------------+
                    | Redis                       |
                    | - BullMQ queue              |
                    | - LLM semaphore leases      |
                    | - rate-limit buckets        |
                    +--------------+--------------+
                                   |
                         +---------v----------+
                         | Evaluation Worker  |
                         | - 消费评估任务      |
                         | - 检索/回答/评分    |
                         +---------+----------+
                                   |
                         +---------v----------+
                         | PostgreSQL/pgvector|
                         | 业务事实与运行结果  |
                         +--------------------+
```

PostgreSQL 继续保存所有业务事实、评估运行状态与结果；Redis 只保存可重建的调度状态、短期租约和限流状态。

## 5. 实施顺序

### 里程碑 R1：基础设施

- 新增 Redis 模块、配置、健康检查、统一 key 前缀和 Lua script 注册。
- Docker Compose 增加 Redis 7、AOF、健康检查和持久卷。
- 区分 liveness 与 readiness；Redis 不可用时 readiness 为失败。

### 里程碑 R2：模型并发隔离

- 在 `model_providers` 统一调用入口接入租约信号量。
- 增加 `online_chat`、`evaluation_answer`、`evaluation_grader`、`embedding` 用途。
- 为在线流量保留容量，验证取消、超时、续租与异常释放。

### 里程碑 R3：评估独立 Worker

- 用 PostgreSQL 任务表/outbox 保证创建运行与待调度记录同事务提交。
- API 只发布任务，独立 Worker 消费 BullMQ。
- 移除 API 内 `setImmediate` 执行路径；补齐重试、取消、心跳和重启恢复。

### 里程碑 R4：外部接口限流

- 用 Redis Lua 令牌桶替换进程内 `Map`。
- 覆盖 Widget、外部 API key 和会话创建/消息接口。
- 返回标准限流响应头，验证多实例共享额度。

R2 与 R3 不应倒序上线；否则评估 Worker 会在没有共享容量约束时直接并发调用模型。

## 6. 故障策略

| 场景 | 行为 |
| --- | --- |
| Redis 启动时不可用 | API/Worker readiness 失败，不接收生产流量 |
| Redis 运行时短暂不可用 | 新评估任务返回可重试错误；模型新调用拒绝获取许可；公网请求限流失败关闭 |
| PostgreSQL 可用、Redis 不可用 | 已保存评估运行保持 `queued`，恢复后由 dispatcher 补投 |
| Worker 崩溃 | BullMQ stalled 检测后重新投递；结果写入必须幂等 |
| Redis 数据丢失 | PostgreSQL 任务表重建评估队列；并发租约和限流状态自然重建 |

这里不采用默认“本地内存降级”。生产环境中静默降级会让多实例限流和模型总并发失效，比明确拒绝请求更危险。仅允许通过显式的紧急配置临时开启单机降级，并记录高等级告警。

## 7. 上线与回滚

1. 先部署 Redis，保持业务代码未启用。
2. 部署支持 Redis 的 API，启用 readiness 但暂不迁移业务路径。
3. 启用模型并发控制，观察许可等待、拒绝、续租失败指标。
4. 部署一个并发度为 1 的 Evaluation Worker，再切换评估发布路径。
5. 最后切换外部限流；压测两个 API 实例是否共享额度。

每项用独立 feature flag 控制：

```text
MIA_REDIS_REQUIRED=true
MIA_LLM_DISTRIBUTED_CONCURRENCY_ENABLED=true
MIA_EVALUATION_QUEUE_ENABLED=true
MIA_EXTERNAL_REDIS_RATE_LIMIT_ENABLED=true
```

回滚时先停止生产新任务，再等待 Worker drain；不得直接清空 Redis。评估调度可回滚到只创建数据库运行记录，但不恢复 API 进程内执行。

## 8. 第一阶段完成定义

- 两个 API 实例与一个 Worker 共用 Redis，模型调用总并发不突破配置值。
- 评估运行在 API 重启后继续执行，Worker 重启不会重复生成同一 case 结果。
- 评估流量满载时，在线 Chat 仍能取得保留并发槽位。
- 外部接口额度跨 API 实例一致，Redis 不可用时不会绕过限流。
- Redis key 不包含 API key、token、Prompt、用户问题或文档正文。
- 健康检查、指标、日志和运维手册能定位 Redis、队列、并发与限流故障。

