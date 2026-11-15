import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";

import { getConfig } from "../core/config";
import { RedisKeyFactory } from "../modules/redis/redis-key.factory";
import { RedisService } from "../modules/redis/redis.service";
import { WorkflowScheduledRunsService } from "../modules/workflow_runtime/workflow-scheduled-runs.service";
import { WORKFLOW_SCHEDULE_QUEUE_NAME } from "./workflow-schedule.queue";

@Injectable()
export class WorkflowScheduleConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly config = getConfig().workflowScheduler;
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly activeControllers = new Map<string, AbortController>();
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory,
    private readonly scheduledRuns: WorkflowScheduledRunsService
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.consumerEnabled) return;
    if (this.config.staleMs <= this.config.heartbeatMs * 2) {
      throw new Error("MIA_WORKFLOW_WORKER_STALE_MS 必须大于心跳间隔的两倍");
    }
    if (!this.redis.isConfigured()) {
      throw new Error("Workflow Schedule Consumer 需要配置 MIA_REDIS_URL");
    }
    this.worker = new Worker(
      WORKFLOW_SCHEDULE_QUEUE_NAME,
      async (job) => this.executeJob(job.data),
      {
        connection: this.redis.createBullConnection(),
        prefix: this.keys.queuePrefix(),
        concurrency: this.config.workerConcurrency
      }
    );
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    for (const controller of this.activeControllers.values()) controller.abort();
    if (!this.worker) return;
    const gracefulClose = this.worker.close();
    let timer: NodeJS.Timeout | undefined;
    const exceededGrace = await Promise.race([
      gracefulClose.then(() => false),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), this.config.shutdownGraceMs);
        timer.unref();
      })
    ]);
    if (timer) clearTimeout(timer);
    if (exceededGrace) await this.worker.disconnect();
  }

  /** 独立为可测试的 Job 边界；销毁 Worker 时统一取消所有尚未完成的 Runtime。 */
  async executeJob(value: unknown): Promise<unknown> {
    const scheduleRunId = this.scheduleRunId(value);
    const controller = new AbortController();
    this.activeControllers.set(scheduleRunId, controller);
    try {
      return await this.scheduledRuns.execute(scheduleRunId, this.workerId, controller.signal);
    } finally {
      this.activeControllers.delete(scheduleRunId);
    }
  }

  private scheduleRunId(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Workflow Schedule Job Data 无效");
    }
    const id = (value as Record<string, unknown>).scheduleRunId;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Workflow Schedule Job 缺少 scheduleRunId");
    }
    return id.trim();
  }
}
