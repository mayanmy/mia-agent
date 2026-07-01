import { Module } from "@nestjs/common";

import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { PgvectorVectorStore } from "./pgvector-store";
import { VECTOR_STORE } from "./vector-store";

@Module({
  imports: [ModelProvidersModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    PgvectorVectorStore,
    {
      provide: VECTOR_STORE,
      useExisting: PgvectorVectorStore
    }
  ],
  exports: [KnowledgeService, VECTOR_STORE]
})
export class KnowledgeModule {}
