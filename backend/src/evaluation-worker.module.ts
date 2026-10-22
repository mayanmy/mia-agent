import { Module } from "@nestjs/common";

import { EvaluationWorkerConsumer } from "./jobs/evaluation-worker.consumer";
import { RagEvaluationJob } from "./jobs/rag-evaluation.job";
import { EvaluationsModule } from "./modules/evaluations/evaluations.module";
import { ModelProvidersModule } from "./modules/model-providers/model-providers.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { RetrievalModule } from "./modules/retrieval/retrieval.module";

@Module({
  imports: [PrismaModule, RedisModule, EvaluationsModule, RetrievalModule, ModelProvidersModule],
  providers: [RagEvaluationJob, EvaluationWorkerConsumer]
})
export class EvaluationWorkerModule {}
