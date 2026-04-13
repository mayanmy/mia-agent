import { Module } from '@nestjs/common';

import { ModelConfigsController } from './model-configs.controller';
import { ModelProvidersController } from './model-providers.controller';
import { ModelProvidersService } from './model-providers.service';

@Module({
  controllers: [ModelProvidersController, ModelConfigsController],
  providers: [ModelProvidersService],
  exports: [ModelProvidersService],
})
export class ModelProvidersModule {}
