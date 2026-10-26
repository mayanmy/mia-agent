import { Module } from "@nestjs/common";

import { EvaluationQueueService } from "../../jobs/evaluation-queue.service";
import { AgentsModule } from "../agents/agents.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { EvaluationsController } from "./evaluations.controller";
import { EvaluationsService } from "./evaluations.service";
import { LlmEvaluationGrader } from "./graders/llm.grader";

@Module({
  imports: [AgentsModule, RetrievalModule, ModelProvidersModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, EvaluationQueueService, LlmEvaluationGrader],
  exports: [EvaluationsService, EvaluationQueueService, LlmEvaluationGrader]
})
export class EvaluationsModule {}
