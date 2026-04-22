import { Module } from '@nestjs/common';

import { ModelProvidersModule } from '../model-providers/model-providers.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ModelProvidersModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
