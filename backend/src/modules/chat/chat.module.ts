import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { ModelProvidersModule } from "../model-providers/model-providers.module";
import { ToolsModule } from "../tools/tools.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [AgentsModule, ModelProvidersModule, ToolsModule],
  controllers: [ChatController],
  providers: [ChatService]
})
export class ChatModule {}
