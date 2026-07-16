import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { ToolsModule } from "../tools/tools.module";
import { ChatController } from "./chat.controller";
import { ChatSessionsService } from "./chat-sessions.service";
import { ChatService } from "./chat.service";

@Module({
  imports: [AgentsModule, ModelProvidersModule, ToolsModule, RetrievalModule],
  controllers: [ChatController],
  providers: [ChatService, ChatSessionsService]
})
export class ChatModule {}
