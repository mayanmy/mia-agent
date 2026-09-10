import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadedFile, UseInterceptors } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentWorkspace } from "../../core/auth/current-workspace.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired, WorkspaceRoles } from "../../core/auth/workspace.decorator";
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
import { CurrentWorkspaceDto } from "../workspaces/dto/workspace.dto";

@Controller("knowledge-bases")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRequired()
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async listKnowledgeBases(
    @Query() query: KnowledgeBaseQueryDto,
    @CurrentWorkspace() currentWorkspace: CurrentWorkspaceDto
  ): Promise<PageResult<KnowledgeBaseListItem>> {
    return this.knowledgeService.listKnowledgeBases(query, currentWorkspace.role);
  }

  @Post()
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async createKnowledgeBase(@Body() payload: KnowledgeBaseCreateDto): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.createKnowledgeBase(payload);
  }

  @Get(":id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async getKnowledgeBase(@Param("id") id: string): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.getKnowledgeBase(id);
  }

  @Put(":id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async updateKnowledgeBase(
    @Param("id") id: string,
    @Body() payload: KnowledgeBaseUpdateDto
  ): Promise<KnowledgeBaseDetail> {
    return this.knowledgeService.updateKnowledgeBase(id, payload);
  }

  @Delete(":id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async deleteKnowledgeBase(@Param("id") id: string): Promise<null> {
    await this.knowledgeService.deleteKnowledgeBase(id);
    return null;
  }

  @Get(":id/documents")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async listKnowledgeDocuments(
    @Param("id") id: string,
    @Query() query: KnowledgeDocumentQueryDto
  ): Promise<PageResult<KnowledgeDocumentListItem>> {
    return this.knowledgeService.listKnowledgeDocuments(id, query);
  }

  @Post(":id/documents")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: 20 * 1024 * 1024
      }
    })
  )
  async uploadKnowledgeDocument(
    @Param("id") id: string,
    @Headers("x-file-name") encodedOriginalFilename: string | undefined,
    @UploadedFile() file: UploadedKnowledgeFile | undefined
  ): Promise<KnowledgeDocumentListItem> {
    return this.knowledgeService.uploadKnowledgeDocument(id, file, encodedOriginalFilename);
  }

  @Post(":id/documents/:documentId/reindex")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async reindexKnowledgeDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string
  ): Promise<KnowledgeDocumentListItem> {
    return this.knowledgeService.reindexKnowledgeDocument(id, documentId);
  }

  @Delete(":id/documents/:documentId")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async deleteKnowledgeDocument(
    @Param("id") id: string,
    @Param("documentId") documentId: string
  ): Promise<null> {
    await this.knowledgeService.deleteKnowledgeDocument(id, documentId);
    return null;
  }
}
