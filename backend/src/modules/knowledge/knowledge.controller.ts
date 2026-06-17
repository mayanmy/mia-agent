import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";

import { PageResult } from "../../core/result";
import {
  KnowledgeBaseCreateDto,
  KnowledgeBaseDetail,
  KnowledgeBaseListItem,
  KnowledgeBaseQueryDto,
  KnowledgeBaseUpdateDto
} from "./dto/knowledge.dto";
import { KnowledgeService } from "./knowledge.service";

@Controller("knowledge-bases")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async listKnowledgeBases(
    @Query() query: KnowledgeBaseQueryDto
  ): Promise<PageResult<KnowledgeBaseListItem>> {
    return this.knowledgeService.listKnowledgeBases(query);
  }

  @Post()
  async createKnowledgeBase(@Body() payload: KnowledgeBaseCreateDto): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.createKnowledgeBase(payload);
  }

  @Get(":id")
  async getKnowledgeBase(@Param("id") id: string): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.getKnowledgeBase(id);
  }

  @Put(":id")
  async updateKnowledgeBase(
    @Param("id") id: string,
    @Body() payload: KnowledgeBaseUpdateDto
  ): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.updateKnowledgeBase(id, payload);
  }

  @Delete(":id")
  async deleteKnowledgeBase(@Param("id") id: string): Promise<null> {
    await this.knowledgeService.deleteKnowledgeBase(id);
    return null;
  }
}
