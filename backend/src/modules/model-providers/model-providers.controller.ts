import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";

import { PageResult } from "../../core/result";
import {
  ProviderCreateDto,
  ProviderDetail,
  ProviderListItem,
  ProviderRemoteModel,
  ProviderQueryDto,
  ProviderTestConnectionResult,
  ProviderUpdateDto
} from "./dto/model-provider.dto";
import { ModelProvidersService } from "./model-providers.service";

@Controller("providers")
export class ModelProvidersController {
  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  @Get()
  async listProviders(@Query() query: ProviderQueryDto): Promise<PageResult<ProviderListItem>> {
    return this.modelProvidersService.listProviders(query);
  }

  @Post()
  async createProvider(@Body() payload: ProviderCreateDto): Promise<ProviderDetail> {
    return this.modelProvidersService.createProvider(payload);
  }

  @Get(":id/models")
  async listProviderModels(@Param("id") id: string): Promise<ProviderRemoteModel[]> {
    return this.modelProvidersService.listProviderModels(id);
  }

  @Get(":id")
  async getProvider(@Param("id") id: string): Promise<ProviderDetail> {
    return this.modelProvidersService.getProvider(id);
  }

  @Put(":id")
  async updateProvider(
    @Param("id") id: string,
    @Body() payload: ProviderUpdateDto
  ): Promise<ProviderDetail> {
    return this.modelProvidersService.updateProvider(id, payload);
  }

  @Delete(":id")
  async deleteProvider(@Param("id") id: string): Promise<null> {
    await this.modelProvidersService.deleteProvider(id);
    return null;
  }

  @Post(":id/test-connection")
  async testConnection(@Param("id") id: string): Promise<ProviderTestConnectionResult> {
    return this.modelProvidersService.testProviderConnection(id);
  }
}
