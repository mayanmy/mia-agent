import { NestFactory } from "@nestjs/core";

import { EvaluationWorkerModule } from "./evaluation-worker.module";

async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(EvaluationWorkerModule);
}

void bootstrap();
