import { Module } from "@nestjs/common";

import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { RetrievalService } from "./retrieval.service";

@Module({
  imports: [KnowledgeModule, ModelProvidersModule],
  providers: [RetrievalService],
  exports: [RetrievalService]
})
export class RetrievalModule {}
