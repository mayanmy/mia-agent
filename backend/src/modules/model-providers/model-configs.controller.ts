import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import { PageResult } from '../../core/result';
import {
  ModelConfigCreateDto,
  ModelConfigDetail,
  ModelConfigListItem,
  ModelConfigQueryDto,
  ModelConfigUpdateDto,
} from './dto/model-provider.dto';
import { ModelProvidersService } from './model-providers.service';

@Controller('model-configs')
export class ModelConfigsController {
  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  @Get()
  async listModelConfigs(
    @Query() query: ModelConfigQueryDto,
  ): Promise<PageResult<ModelConfigListItem>> {
    return this.modelProvidersService.listModelConfigs(query);
  }

  @Post()
  async createModelConfig(@Body() payload: ModelConfigCreateDto): Promise<ModelConfigDetail> {
    return this.modelProvidersService.createModelConfig(payload);
  }

  @Get(':id')
  async getModelConfig(@Param('id') id: string): Promise<ModelConfigDetail> {
    return this.modelProvidersService.getModelConfig(id);
  }

  @Put(':id')
  async updateModelConfig(
    @Param('id') id: string,
    @Body() payload: ModelConfigUpdateDto,
  ): Promise<ModelConfigDetail> {
    return this.modelProvidersService.updateModelConfig(id, payload);
  }

  @Delete(':id')
  async deleteModelConfig(@Param('id') id: string): Promise<null> {
    await this.modelProvidersService.deleteModelConfig(id);
    return null;
  }
}
