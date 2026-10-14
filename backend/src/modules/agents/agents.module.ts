import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { SkillsModule } from "../skills/skills.module";
import { ToolsModule } from "../tools/tools.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { AgentsController } from "./agents.controller";
import { AgentsService } from "./agents.service";

@Module({
  imports: [ModelProvidersModule, ToolsModule, KnowledgeModule, WorkflowsModule, SkillsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService]
})
export class AgentsModule {}
