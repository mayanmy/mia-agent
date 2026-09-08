import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  WorkspaceCreateDto,
  WorkspaceInvitationCreateDto,
  WorkspaceInvitationResponse,
  WorkspaceListItem,
  WorkspaceMemberListItem,
  WorkspaceMemberRoleUpdateDto,
  WorkspaceOwnershipTransferDto,
  WorkspaceUpdateDto
} from "./dto/workspace.dto";
import { WorkspacesService } from "./workspaces.service";

/** 项目空间和成员关系 API；每个用例在 Service 内实时验证目标空间成员资格。 */
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  /** 返回当前账号加入的项目空间，用于登录后选择当前空间。 */
  @Get()
  list(@CurrentUser() currentUser: CurrentUserDto): Promise<WorkspaceListItem[]> {
    return this.workspacesService.listWorkspaces(currentUser.id);
  }

  /** 创建项目空间，当前账号自动成为 OWNER。 */
  @Post()
  create(
    @CurrentUser() currentUser: CurrentUserDto,
    @Body() payload: WorkspaceCreateDto
  ): Promise<WorkspaceListItem> {
    return this.workspacesService.createWorkspace(currentUser.id, payload);
  }

  /** 返回当前成员可访问的项目空间详情。 */
  @Get(":workspaceId")
  get(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string
  ): Promise<WorkspaceListItem> {
    return this.workspacesService.getWorkspace(currentUser.id, workspaceId);
  }

  /** OWNER/ADMIN 更新项目空间资料。 */
  @Put(":workspaceId")
  update(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Body() payload: WorkspaceUpdateDto
  ): Promise<WorkspaceListItem> {
    return this.workspacesService.updateWorkspace(currentUser.id, workspaceId, payload);
  }

  /** OWNER 软删除项目空间并使其全部成员关系失效。 */
  @Delete(":workspaceId")
  async delete(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string
  ): Promise<null> {
    await this.workspacesService.deleteWorkspace(currentUser.id, workspaceId);
    return null;
  }

  /** 返回当前项目空间的有效成员。 */
  @Get(":workspaceId/members")
  listMembers(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string
  ): Promise<WorkspaceMemberListItem[]> {
    return this.workspacesService.listMembers(currentUser.id, workspaceId);
  }

  /** OWNER/ADMIN 创建或重新生成空间邀请。 */
  @Post(":workspaceId/invitations")
  createInvitation(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Body() payload: WorkspaceInvitationCreateDto
  ): Promise<WorkspaceInvitationResponse> {
    return this.workspacesService.createInvitation(currentUser.id, workspaceId, payload);
  }

  /** OWNER/ADMIN 撤销尚未使用的空间邀请。 */
  @Delete(":workspaceId/invitations/:invitationId")
  async revokeInvitation(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string
  ): Promise<null> {
    await this.workspacesService.revokeInvitation(currentUser.id, workspaceId, invitationId);
    return null;
  }

  /** 调整普通成员或管理员角色；OWNER 使用独立转让接口。 */
  @Put(":workspaceId/members/:userId/role")
  async updateMemberRole(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @Body() payload: WorkspaceMemberRoleUpdateDto
  ): Promise<null> {
    await this.workspacesService.updateMemberRole(currentUser.id, workspaceId, userId, payload);
    return null;
  }

  /** 从当前项目空间移除指定成员，不影响其全局账号和其他空间。 */
  @Delete(":workspaceId/members/:userId")
  async removeMember(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string
  ): Promise<null> {
    await this.workspacesService.removeMember(currentUser.id, workspaceId, userId);
    return null;
  }

  /** OWNER 原子转让项目空间所有权。 */
  @Post(":workspaceId/transfer-ownership")
  async transferOwnership(
    @CurrentUser() currentUser: CurrentUserDto,
    @Param("workspaceId") workspaceId: string,
    @Body() payload: WorkspaceOwnershipTransferDto
  ): Promise<null> {
    await this.workspacesService.transferOwnership(currentUser.id, workspaceId, payload);
    return null;
  }
}
