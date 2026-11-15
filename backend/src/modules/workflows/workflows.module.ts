import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { ToolsModule } from "../tools/tools.module";
import { WorkflowCompiler } from "./workflow-compiler";
import { WorkflowSchedulePlanner } from "./workflow-schedule-planner";
import { WorkflowSchedulesController } from "./workflow-schedules.controller";
import { WorkflowSchedulesService } from "./workflow-schedules.service";
import { WorkflowScheduleCancellationService } from "./workflow-schedule-cancellation.service";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [ModelProvidersModule, KnowledgeModule, ToolsModule],
  controllers: [WorkflowsController, WorkflowSchedulesController],
  providers: [
    WorkflowsService,
    WorkflowCompiler,
    WorkflowSchedulePlanner,
    WorkflowSchedulesService,
    WorkflowScheduleCancellationService
  ],
  exports: [WorkflowsService, WorkflowSchedulesService, WorkflowScheduleCancellationService]
})
export class WorkflowsModule {}
