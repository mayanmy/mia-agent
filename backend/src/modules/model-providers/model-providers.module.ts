import { Module } from '@nestjs/common';

import { ModelConfigsController } from './model-configs.controller';
import { OllamaClient } from './clients/ollama.client';
import { OpenAICompatibleClient } from './clients/openai-compatible.client';
import { ModelProvidersGateway } from './gateway';
import { ModelProvidersController } from './model-providers.controller';
import { ModelProvidersService } from './model-providers.service';

@Module({
  controllers: [ModelProvidersController, ModelConfigsController],
  providers: [ModelProvidersService, ModelProvidersGateway, OpenAICompatibleClient, OllamaClient],
  exports: [ModelProvidersService],
})
export class ModelProvidersModule {}
