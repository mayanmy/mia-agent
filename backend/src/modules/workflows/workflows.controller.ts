import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { PageResult } from "../../core/result";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  WorkflowCreateDto,
  WorkflowDetail,
  WorkflowDraftUpdateDto,
  WorkflowDraftUpdateResult,
  WorkflowListItem,
  WorkflowQueryDto,
  WorkflowUpdateDto
} from "./dto/workflow.dto";
import {
  WorkflowPublishDto,
  WorkflowPublishResult,
  WorkflowValidateDto,
  WorkflowValidationResult
} from "./dto/workflow-validation.dto";
import { WorkflowVersionDetail, WorkflowVersionListItem } from "./dto/workflow-version.dto";
import { WorkflowsService } from "./workflows.service";

@Controller("workflows")
@Roles(UserRole.ADMIN)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get()
  listWorkflows(@Query() query: WorkflowQueryDto): Promise<PageResult<WorkflowListItem>> {
    return this.workflowsService.listWorkflows(query);
  }

  @Post()
  createWorkflow(
    @Body() payload: WorkflowCreateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<WorkflowDetail> {
    return this.workflowsService.createWorkflow(payload, currentUser.id);
  }

  @Get(":id")
  getWorkflow(@Param("id") id: string): Promise<WorkflowDetail> {
    return this.workflowsService.getWorkflow(id);
  }

  @Put(":id")
  updateWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowUpdateDto
  ): Promise<WorkflowDetail> {
    return this.workflowsService.updateWorkflow(id, payload);
  }

  @Put(":id/draft")
  updateDraft(
    @Param("id") id: string,
    @Body() payload: WorkflowDraftUpdateDto
  ): Promise<WorkflowDraftUpdateResult> {
    return this.workflowsService.updateDraft(id, payload);
  }

  @Post(":id/validate")
  validateWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowValidateDto
  ): Promise<WorkflowValidationResult> {
    return this.workflowsService.validateWorkflow(id, payload);
  }

  @Post(":id/publish")
  publishWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowPublishDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<WorkflowPublishResult> {
    return this.workflowsService.publishWorkflow(id, payload, currentUser.id);
  }

  @Delete(":id")
  async archiveWorkflow(@Param("id") id: string): Promise<null> {
    await this.workflowsService.archiveWorkflow(id);
    return null;
  }

  @Get(":id/versions")
  listVersions(@Param("id") id: string): Promise<WorkflowVersionListItem[]> {
    return this.workflowsService.listVersions(id);
  }

  @Get(":id/versions/:versionId")
  getVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string
  ): Promise<WorkflowVersionDetail> {
    return this.workflowsService.getVersion(id, versionId);
  }
}
