import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";

import { RedisKeyFactory } from "../modules/redis/redis-key.factory";
import { RedisService } from "../modules/redis/redis.service";
import { EVALUATION_QUEUE_NAME } from "./evaluation-queue.service";
import { RagEvaluationJob } from "./rag-evaluation.job";

@Injectable()
export class EvaluationWorkerConsumer implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory,
    private readonly evaluationJob: RagEvaluationJob
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      EVALUATION_QUEUE_NAME,
      async (job) => this.evaluationJob.execute(String(job.data.runId)),
      {
        connection: this.redis.createBullConnection(),
        prefix: this.keys.queuePrefix(),
        concurrency: Number(process.env.MIA_EVALUATION_WORKER_CONCURRENCY ?? 1)
      }
    );
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
