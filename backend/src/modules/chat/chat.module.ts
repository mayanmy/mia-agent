import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { AgentRuntimeModule } from "../agent_runtime/agent-runtime.module";
import { AgentRunsModule } from "../agent_runs/agent-runs.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { ToolsModule } from "../tools/tools.module";
import { ChatController } from "./chat.controller";
import { ChatSessionsService } from "./chat-sessions.service";
import { ChatService } from "./chat.service";
import { ChatStreamsService } from "./chat-streams.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [
    AgentsModule,
    AgentRuntimeModule,
    AgentRunsModule,
    ModelProvidersModule,
    ToolsModule,
    RetrievalModule,
    StorageModule
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatSessionsService, ChatStreamsService],
  exports: [ChatService]
})
export class ChatModule {}
