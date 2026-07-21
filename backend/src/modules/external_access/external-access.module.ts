import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { AuthModule } from "../auth/auth.module";
import { ChatModule } from "../chat/chat.module";
import { AgentApiKeysService } from "./agent-api-keys.service";
import {
  AgentApiKeysController,
  PublicAgentsController,
  ServiceApiController
} from "./external-access.controller";
import { ExternalAccessService } from "./external-access.service";
import { ExternalRateLimiterService } from "./external-rate-limiter.service";
import { AgentApiKeyGuard } from "./guards/agent-api-key.guard";
import { PublicAccessService } from "./public-access.service";

@Module({
  imports: [AgentsModule, AuthModule, ChatModule],
  controllers: [AgentApiKeysController, PublicAgentsController, ServiceApiController],
  providers: [
    AgentApiKeysService,
    ExternalAccessService,
    ExternalRateLimiterService,
    PublicAccessService,
    AgentApiKeyGuard
  ],
  exports: [AgentApiKeysService]
})
export class ExternalAccessModule {}
