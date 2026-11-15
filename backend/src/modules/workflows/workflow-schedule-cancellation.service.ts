import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

import { getConfig } from "../../core/config";
import { RedisKeyFactory } from "../redis/redis-key.factory";
import { RedisService } from "../redis/redis.service";
import { WorkflowScheduleRunCancelResult } from "./dto/workflow-schedule.dto";
import { WorkflowSchedulesService } from "./workflow-schedules.service";

/** 数据库保存取消事实，Redis Pub/Sub 只把取消更快传给持有 AbortController 的 Worker。 */
@Injectable()
export class WorkflowScheduleCancellationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduleCancellationService.name);
  private readonly consumerEnabled = getConfig().workflowScheduler.consumerEnabled;
  private readonly listeners = new Map<string, Set<() => void>>();
  private subscriber?: Redis;

  constructor(
    private readonly schedules: WorkflowSchedulesService,
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.consumerEnabled || !this.redis.isConfigured()) return;
    this.subscriber = this.redis.createSubscriber();
    this.subscriber.on("message", (channel, scheduleRunId) => {
      if (channel !== this.keys.workflowScheduleCancelChannel()) return;
      for (const listener of this.listeners.get(scheduleRunId) ?? []) listener();
    });
    await this.subscriber.subscribe(this.keys.workflowScheduleCancelChannel());
  }

  async requestCancel(runId: string): Promise<WorkflowScheduleRunCancelResult> {
    const result = await this.schedules.requestScheduleRunCancel(runId);
    if (result.status === "RUNNING" && this.redis.isConfigured()) {
      await this.redis
        .publish(this.keys.workflowScheduleCancelChannel(), result.runId)
        .catch((error: unknown) => {
          // 通知失败不回滚数据库取消事实，Worker 仍会通过轮询发现请求。
          this.logger.warn(
            `Workflow Schedule 取消通知失败: run=${result.runId} error=${this.errorMessage(error)}`
          );
        });
    }
    return result;
  }

  watch(scheduleRunId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(scheduleRunId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(scheduleRunId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(scheduleRunId);
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    if (this.subscriber) {
      await this.subscriber.unsubscribe().catch(() => undefined);
      await this.subscriber.quit().catch(() => this.subscriber?.disconnect());
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown";
  }
}
