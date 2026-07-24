import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { ToolsModule } from "../tools/tools.module";
import { WorkflowCompiler } from "./workflow-compiler";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [ModelProvidersModule, KnowledgeModule, ToolsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowCompiler],
  exports: [WorkflowsService]
})
export class WorkflowsModule {}
