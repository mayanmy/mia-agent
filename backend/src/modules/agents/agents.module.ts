import { Module } from '@nestjs/common';

import { ModelProvidersModule } from '../model-providers/model-providers.module';
import { ToolsModule } from '../tools/tools.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ModelProvidersModule, ToolsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
