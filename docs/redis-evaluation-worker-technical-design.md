# RAG 评估 BullMQ 独立 Worker 技术方案

> 状态：待实施  
> 所属：`evaluations` + `jobs`  
> 前置：[Redis 基础设施](./redis-foundation-technical-design.md)、[模型并发隔离](./redis-model-concurrency-technical-design.md)

## 1. 现状与目标

当前 `RagEvaluationJob.enqueue()` 通过 `setImmediate()` 在 API 进程内执行。它存在以下问题：

- API 重启会中断任务，待执行状态无法自动恢复。
- 评估检索、模型回答和裁判调用与在线请求争用 CPU、连接及模型并发。
- 多 API 实例无法可靠控制同一运行只执行一次。
- 运行取消、重试、stalled 恢复和 Worker 运维边界不清晰。

目标是让 API 只创建评估运行并发布任务，独立 `evaluation-worker` 进程消费 BullMQ。评估结果仍写入 PostgreSQL。

## 2. 一致性模型

不直接采用“提交数据库后立刻 `queue.add`”作为唯一保障，因为 PostgreSQL 与 Redis 无法处于同一事务。使用 PostgreSQL 任务表作为 transactional outbox：

```text
HTTP 创建评估
  -> PostgreSQL transaction
     -> insert evaluation_run(status=QUEUED)
     -> insert evaluation_job(run_id, dispatch_status=PENDING)
  -> dispatcher 扫描 PENDING
  -> BullMQ add(jobId=run_id)
  -> 标记 DISPATCHED
```

`jobId=runId` 用于 BullMQ 去重，但不能替代数据库幂等约束。Worker 每个关键写入都必须以 PostgreSQL 状态和唯一键为准。

建议新增表字段：

```text
evaluation_jobs
  id
  run_id unique
  dispatch_status: PENDING | DISPATCHED | COMPLETED | DEAD
  dispatch_attempts
  next_dispatch_at
  last_error_code
  dispatched_at
  created_at
  updated_at
```

这张表归属 `evaluations` 模块；dispatcher 属于 `jobs/` 编排层，通过 `EvaluationsService` 访问，不跨模块直接查表。

## 3. 代码结构

```text
backend/src/
  evaluation-worker.ts
  evaluation-worker.module.ts
  jobs/
    rag-evaluation.job.ts
    evaluation-queue.publisher.ts
    evaluation-job.dispatcher.ts
    evaluation-worker.consumer.ts
  modules/evaluations/
    evaluations.service.ts
    dto/evaluation-job.dto.ts
```

- `evaluation-worker.ts` 创建 Nest application context，不启动 HTTP server。
- `EvaluationQueuePublisher` 只封装 BullMQ 队列操作。
- `EvaluationJobDispatcher` 领取待投递记录并发布，必须支持多实例安全领取。
- `EvaluationWorkerConsumer` 调用现有 `RagEvaluationJob.execute(runId)` 编排逻辑。
- `EvaluationsService` 负责运行/任务状态、幂等 case 结果和取消状态。

API 的 `EvaluationsModule` 不再注册能执行评估的消费者；Worker module 才注册 consumer。

## 4. 队列设计

```text
queue name: rag-evaluation
job name: execute-run
job data: { runId, requestId }
jobId: runId
attempts: 3
backoff: exponential, 5s
removeOnComplete: age 7d, count 1000
removeOnFail: age 30d, count 5000
worker concurrency: 1（首发默认）
```

job data 只传可 JSON 序列化的 ID，不传数据集、Agent 配置、Prompt 或 Prisma 对象。Worker 开始执行时从所属模块 service 加载冻结后的运行快照。

仅对基础设施型失败自动重试：Redis 短暂断开、Provider 5xx、请求首 token 前网络失败。配置错误、数据集损坏、鉴权失败和明确业务失败直接结束运行，不能无意义重试。

## 5. 状态机与幂等

```text
QUEUED -> RUNNING -> SUCCEEDED
                  -> PARTIAL
                  -> FAILED
       -> CANCELED
RUNNING -> CANCEL_REQUESTED -> CANCELED
```

- Worker 通过条件更新 `QUEUED -> RUNNING` 取得执行权；更新失败即视为重复消息并安全返回。
- case 结果以 `(run_id, case_id)` 建唯一约束，重试时 upsert，不重复计数。
- 汇总指标只从已落库 case 结果重新计算，不在 Redis 累加业务指标。
- 已终态运行收到重复 job 时直接 ack。
- Worker 每 15 秒更新数据库 heartbeat/progress；超过阈值由恢复任务判断是否重投。

BullMQ 是投递与运行协调层，不是评估运行状态的权威来源。

## 6. 取消与超时

取消接口按以下顺序处理：

1. 数据库设置 `CANCEL_REQUESTED`。
2. 发布 `{prefix}:events:evaluation-cancel`，消息仅包含 `runId`。
3. Worker 收到后触发当前 case 的 `AbortController`。
4. 每个 case 开始前、检索后、模型回答后都再次检查数据库状态。
5. 写入 `CANCELED` 并释放模型并发许可。

Pub/Sub 只用于加速通知，数据库取消状态才是可靠事实；即使通知丢失，轮询检查也会停止任务。

运行需设置总超时，单 case 继承检索、回答、裁判各自超时。Worker 退出时先 `pause` 并等待当前 case 到安全点，超过 shutdown grace period 后中止上游调用。

## 7. 资源隔离

- Worker 默认实例数 1、BullMQ concurrency 1。
- 回答与裁判请求分别标记 `evaluation_answer` 和 `evaluation_grader`。
- 两者必须经过共享模型并发服务，不能在 Worker 内另做一套 semaphore。
- 评估 embedding 使用 `embedding` 用途，并设置独立上限。
- Worker 容器设置 CPU/内存限制；临时文件和知识库原文件通过既有 storage service 访问。

## 8. 部署

在 `docker-compose.backend.yml` 增加与 API 使用同一镜像的服务：

```yaml
evaluation-worker:
  build:
    context: ./backend
    target: runtime
  command: ["node", "dist/evaluation-worker.js"]
  restart: unless-stopped
  environment:
    DATABASE_URL: ${DATABASE_URL}
    MIA_REDIS_URL: redis://redis:6379/0
    MIA_EVALUATION_WORKER_CONCURRENCY: 1
  depends_on:
    migrate:
      condition: service_completed_successfully
    redis:
      condition: service_healthy
```

需要确保生产镜像同时包含 API 与 Worker 两个编译入口。Worker 不映射端口；健康状态通过 Redis heartbeat 或容器进程状态观察。

## 9. 可观测性

```text
mia_evaluation_queue_waiting
mia_evaluation_queue_active
mia_evaluation_queue_failed
mia_evaluation_job_duration_seconds
mia_evaluation_job_retries_total{reason}
mia_evaluation_worker_heartbeat_timestamp
mia_evaluation_case_duration_seconds{stage}
```

日志贯穿 `request_id`、`run_id`、`case_id`、`bull_job_id`、`attempt`。不得记录完整 Prompt、参考答案或知识库正文。

## 10. 测试与验收

- API 创建运行后立即重启，Worker 仍能从任务表/BullMQ 执行。
- 数据库提交成功但 `queue.add` 失败，dispatcher 恢复后能补投。
- 同一 `runId` 重复投递，不产生重复 case 结果。
- Worker 执行中崩溃，stalled 恢复后从已完成 case 继续。
- 取消运行后，上游模型请求被中止且状态最终为 `CANCELED`。
- Worker 满载时在线 Chat 仍有保留模型并发。
- Redis 丢失队列数据后，可从 PostgreSQL 非终态任务重建。

