import { NestFactory } from "@nestjs/core";

import { WorkflowWorkerModule } from "./workflow-worker.module";

async function bootstrap(): Promise<void> {
  const context = await NestFactory.createApplicationContext(WorkflowWorkerModule);
  context.enableShutdownHooks();
}

void bootstrap();
