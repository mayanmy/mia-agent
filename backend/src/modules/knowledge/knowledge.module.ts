import { Module } from "@nestjs/common";

import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

@Module({
  imports: [ModelProvidersModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService]
})
export class KnowledgeModule {}
