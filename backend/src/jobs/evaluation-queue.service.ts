import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";

import { getConfig } from "../core/config";
import { PrismaService } from "../modules/prisma/prisma.service";
import { RedisKeyFactory } from "../modules/redis/redis-key.factory";
import { RedisService } from "../modules/redis/redis.service";

export const EVALUATION_QUEUE_NAME = "rag-evaluation";

@Injectable()
export class EvaluationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvaluationQueueService.name);
  private readonly enabled = getConfig().redis.required;
  private queue?: Queue;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.redis.isConfigured()) return;
    this.queue = new Queue(EVALUATION_QUEUE_NAME, {
      connection: this.redis.createBullConnection(),
      prefix: this.keys.queuePrefix()
    });
    await this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), 5_000);
    this.timer.unref();
  }

  async dispatchPending(): Promise<void> {
    if (!this.queue) return;
    const jobs = await this.prisma.evaluationJob.findMany({
      where: { dispatchStatus: "PENDING", nextDispatchAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 20
    });
    for (const job of jobs) {
      try {
        await this.queue.add(
          "execute-run",
          { runId: job.runId },
          { jobId: job.runId, attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 }
        );
        await this.prisma.evaluationJob.update({
          where: { id: job.id },
          data: { dispatchStatus: "DISPATCHED", dispatchedAt: new Date(), dispatchAttempts: { increment: 1 }, lastErrorCode: null }
        });
      } catch (error) {
        this.logger.error(`Failed to dispatch evaluation run ${job.runId}`);
        await this.prisma.evaluationJob.update({
          where: { id: job.id },
          data: {
            dispatchAttempts: { increment: 1 },
            lastErrorCode: error instanceof Error ? error.name : "QUEUE_ERROR",
            nextDispatchAt: new Date(Date.now() + 5_000)
          }
        });
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue?.close();
  }
}
