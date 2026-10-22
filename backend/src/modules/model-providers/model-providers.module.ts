import { Module } from "@nestjs/common";

import { ModelConfigsController } from "./model-configs.controller";
import { ModelDefaultsController } from "./model-defaults.controller";
import { OllamaClient } from "./clients/ollama.client";
import { OpenAICompatibleClient } from "./clients/openai-compatible.client";
import { ModelProvidersGateway } from "./gateway";
import { ModelProvidersController } from "./model-providers.controller";
import { ModelProvidersService } from "./model-providers.service";
import { ModelCapacityService } from "./model-capacity.service";

@Module({
  controllers: [ModelProvidersController, ModelConfigsController, ModelDefaultsController],
  providers: [ModelProvidersService, ModelProvidersGateway, ModelCapacityService, OpenAICompatibleClient, OllamaClient],
  exports: [ModelProvidersService]
})
export class ModelProvidersModule {}
