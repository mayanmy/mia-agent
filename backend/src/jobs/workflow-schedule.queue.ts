import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";

import { getConfig } from "../core/config";
import { RedisKeyFactory } from "../modules/redis/redis-key.factory";
import { RedisService } from "../modules/redis/redis.service";
import { WorkflowScheduleJobDispatchDto } from "../modules/workflows/dto/workflow-schedule.dto";

export const WORKFLOW_SCHEDULE_QUEUE_NAME = "workflow-scheduled-runs";
export const WORKFLOW_SCHEDULE_JOB_NAME = "execute-scheduled-run";

export type WorkflowScheduleQueueJob = {
  name: typeof WORKFLOW_SCHEDULE_JOB_NAME;
  jobId: string;
  data: { scheduleRunId: string };
};

/** BullMQ 投递边界；dry-run 时只生成确定性载荷，正式模式才建立 Redis Queue。 */
@Injectable()
export class WorkflowScheduleQueue implements OnModuleInit, OnModuleDestroy {
  private readonly config = getConfig().workflowScheduler;
  private queue?: Queue;

  constructor(
    private readonly redis?: RedisService,
    private readonly keys?: RedisKeyFactory
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.dispatcherEnabled || this.config.dispatcherDryRun) return;
    if (!this.redis?.isConfigured() || !this.keys) {
      throw new Error("Workflow Schedule Dispatcher 需要配置 MIA_REDIS_URL");
    }
    this.queue = new Queue(WORKFLOW_SCHEDULE_QUEUE_NAME, {
      connection: this.redis.createBullConnection(),
      prefix: this.keys.queuePrefix()
    });
    await this.queue.waitUntilReady();
  }

  prepare(job: WorkflowScheduleJobDispatchDto): WorkflowScheduleQueueJob {
    return {
      name: WORKFLOW_SCHEDULE_JOB_NAME,
      jobId: job.scheduleRunId,
      data: { scheduleRunId: job.scheduleRunId }
    };
  }

  async enqueue(job: WorkflowScheduleJobDispatchDto): Promise<void> {
    if (!this.queue) throw new Error("Workflow Schedule Queue 尚未初始化");
    const prepared = this.prepare(job);
    const existing = await this.queue.getJob(prepared.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") {
        await existing.remove();
      } else {
        // 并发延迟期间旧 Job 仍 active 时必须让 Outbox 再次延期，不能误标 DISPATCHED。
        throw new Error(`Workflow Schedule Job 已存在且状态为 ${state}`);
      }
    }
    await this.queue.add(prepared.name, prepared.data, {
      jobId: prepared.jobId,
      attempts: 1,
      removeOnComplete: { age: 7 * 86_400, count: 5_000 },
      removeOnFail: { age: 30 * 86_400, count: 10_000 }
    });
  }

  async hasRunnableJob(scheduleRunId: string): Promise<boolean> {
    if (!this.queue) return false;
    const job = await this.queue.getJob(scheduleRunId);
    if (!job) return false;
    const state = await job.getState();
    return (
      state === "active" || state === "waiting" || state === "delayed" || state === "prioritized"
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}
