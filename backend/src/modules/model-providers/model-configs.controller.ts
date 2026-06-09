import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";

import { PageResult } from "../../core/result";
import { ChatCompletionResponse, TestChatCompletionDto } from "./dto/llm.dto";
import {
  ModelCapabilityCheckDto,
  ModelCapabilityCheckResult,
  ModelConfigCreateDto,
  ModelConfigDetail,
  ModelConfigListItem,
  ModelConfigQueryDto,
  ModelConfigUpdateDto
} from "./dto/model-provider.dto";
import { ModelProvidersService } from "./model-providers.service";

@Controller("model-configs")
export class ModelConfigsController {
  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  @Get()
  async listModelConfigs(
    @Query() query: ModelConfigQueryDto
  ): Promise<PageResult<ModelConfigListItem>> {
    return this.modelProvidersService.listModelConfigs(query);
  }

  @Post()
  async createModelConfig(@Body() payload: ModelConfigCreateDto): Promise<ModelConfigDetail> {
    return this.modelProvidersService.createModelConfig(payload);
  }

  @Post("check-capability")
  async checkCapability(
    @Body() payload: ModelCapabilityCheckDto
  ): Promise<ModelCapabilityCheckResult> {
    return this.modelProvidersService.checkModelCapability(
      payload.providerId,
      payload.modelName,
      payload.modelType
    );
  }

  @Get(":id")
  async getModelConfig(@Param("id") id: string): Promise<ModelConfigDetail> {
    return this.modelProvidersService.getModelConfig(id);
  }

  @Put(":id")
  async updateModelConfig(
    @Param("id") id: string,
    @Body() payload: ModelConfigUpdateDto
  ): Promise<ModelConfigDetail> {
    return this.modelProvidersService.updateModelConfig(id, payload);
  }

  @Delete(":id")
  async deleteModelConfig(@Param("id") id: string): Promise<null> {
    await this.modelProvidersService.deleteModelConfig(id);
    return null;
  }

  @Post(":id/test-chat-completion")
  async testChatCompletion(
    @Param("id") id: string,
    @Body() payload: TestChatCompletionDto
  ): Promise<ChatCompletionResponse> {
    return this.modelProvidersService.createChatCompletion({
      modelConfigId: id,
      messages: payload.messages ?? [
        {
          role: "user",
          content: payload.prompt ?? "请用一句话回复：Mia 模型调用网关测试成功。"
        }
      ],
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      timeoutSeconds: payload.timeoutSeconds
    });
  }
}
