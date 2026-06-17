import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadedFile, UseInterceptors } from "@nestjs/common";

import { PageResult } from "../../core/result";
import {
  KnowledgeBaseCreateDto,
  KnowledgeBaseDetail,
  KnowledgeBaseListItem,
  KnowledgeBaseQueryDto,
  KnowledgeBaseUpdateDto,
  KnowledgeDocumentListItem,
  KnowledgeDocumentQueryDto,
  UploadedKnowledgeFile
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

  @Get(":id/documents")
  async listKnowledgeDocuments(
    @Param("id") id: string,
    @Query() query: KnowledgeDocumentQueryDto
  ): Promise<PageResult<KnowledgeDocumentListItem>> {
    return this.knowledgeService.listKnowledgeDocuments(id, query);
  }

  @Post(":id/documents")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 20 * 1024 * 1024
      }
    })
  )
  async uploadKnowledgeDocument(
    @Param("id") id: string,
    @UploadedFile() file: UploadedKnowledgeFile | undefined
  ): Promise<KnowledgeDocumentListItem> {
    return this.knowledgeService.uploadKnowledgeDocument(id, file);
  }

  @Delete(":id/documents/:documentId")
  async deleteKnowledgeDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string
  ): Promise<null> {
    await this.knowledgeService.deleteKnowledgeDocument(id, documentId);
    return null;
  }
}
