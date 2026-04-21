import { Body, Controller, Get, Put } from '@nestjs/common';

import {
  DefaultModelSettings,
  DefaultModelSettingsUpdateDto,
} from './dto/model-provider.dto';
import { ModelProvidersService } from './model-providers.service';

@Controller('model-defaults')
export class ModelDefaultsController {
  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  @Get()
  async getDefaultModelSettings(): Promise<DefaultModelSettings> {
    return this.modelProvidersService.getDefaultModelSettings();
  }

  @Put()
  async updateDefaultModelSettings(
    @Body() payload: DefaultModelSettingsUpdateDto,
  ): Promise<DefaultModelSettings> {
    return this.modelProvidersService.updateDefaultModelSettings(payload);
  }
}
