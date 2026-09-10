import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRoles } from "../../core/auth/workspace.decorator";
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
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  /** 分页查询未归档 Workflow。 */
  @Get()
  listWorkflows(@Query() query: WorkflowQueryDto): Promise<PageResult<WorkflowListItem>> {
    return this.workflowsService.listWorkflows(query);
  }

  /** 创建 Workflow 草稿容器。 */
  @Post()
  createWorkflow(
    @Body() payload: WorkflowCreateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<WorkflowDetail> {
    return this.workflowsService.createWorkflow(payload, currentUser.id);
  }

  /** 获取 Workflow 编辑详情和当前草稿。 */
  @Get(":id")
  getWorkflow(@Param("id") id: string): Promise<WorkflowDetail> {
    return this.workflowsService.getWorkflow(id);
  }

  /** 更新 Workflow 名称和描述，不改变草稿修订号。 */
  @Put(":id")
  updateWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowUpdateDto
  ): Promise<WorkflowDetail> {
    return this.workflowsService.updateWorkflow(id, payload);
  }

  /** 使用 expectedRevision 乐观锁保存完整草稿 Graph。 */
  @Put(":id/draft")
  updateDraft(
    @Param("id") id: string,
    @Body() payload: WorkflowDraftUpdateDto
  ): Promise<WorkflowDraftUpdateResult> {
    return this.workflowsService.updateDraft(id, payload);
  }

  /** 编译并校验临时 Graph 或服务端最新草稿。 */
  @Post(":id/validate")
  validateWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowValidateDto
  ): Promise<WorkflowValidationResult> {
    return this.workflowsService.validateWorkflow(id, payload);
  }

  /** 校验当前 revision 并创建不可变 Workflow Version。 */
  @Post(":id/publish")
  publishWorkflow(
    @Param("id") id: string,
    @Body() payload: WorkflowPublishDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<WorkflowPublishResult> {
    return this.workflowsService.publishWorkflow(id, payload, currentUser.id);
  }

  /** 软删除 Workflow，保留历史版本和 Run Trace。 */
  @Delete(":id")
  async archiveWorkflow(@Param("id") id: string): Promise<null> {
    await this.workflowsService.archiveWorkflow(id);
    return null;
  }

  /** 查询 Workflow 的全部不可变版本。 */
  @Get(":id/versions")
  listVersions(@Param("id") id: string): Promise<WorkflowVersionListItem[]> {
    return this.workflowsService.listVersions(id);
  }

  /** 获取指定 Workflow Version 的 Graph 和编译计划。 */
  @Get(":id/versions/:versionId")
  getVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string
  ): Promise<WorkflowVersionDetail> {
    return this.workflowsService.getVersion(id, versionId);
  }
}
