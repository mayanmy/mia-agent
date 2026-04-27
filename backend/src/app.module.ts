import { Module } from '@nestjs/common';

import { AgentsModule } from './modules/agents/agents.module';
import { ChatModule } from './modules/chat/chat.module';
import { HealthModule } from './modules/health/health.module';
import { ModelProvidersModule } from './modules/model-providers/model-providers.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ToolsModule } from './modules/tools/tools.module';

@Module({
  imports: [PrismaModule, HealthModule, ModelProvidersModule, AgentsModule, ChatModule, ToolsModule],
})
export class AppModule {}
