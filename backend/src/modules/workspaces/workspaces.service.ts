import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, WorkspaceRole } from "@prisma/client";

import { getConfig } from "../../core/config";
import { AppError, ErrorCodes } from "../../core/errors";
import { TokenService } from "../auth/token.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeUserEmail } from "../users/users.service";
import {
  CurrentWorkspaceDto,
  WorkspaceCreateDto,
  WorkspaceInvitationCreateDto,
  WorkspaceInvitationResponse,
  WorkspaceListItem,
  WorkspaceMemberListItem,
  WorkspaceMemberRoleUpdateDto,
  WorkspaceOwnershipTransferDto,
  WorkspaceUpdateDto
} from "./dto/workspace.dto";

@Injectable()
export class WorkspacesService {
  private readonly config = getConfig();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {}

  /** 返回当前用户加入的全部有效项目空间，不暴露其他空间是否存在。 */
  async listWorkspaces(userId: string): Promise<WorkspaceListItem[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId,
        removedAt: null,
        workspace: { deletedAt: null }
      },
      include: {
        workspace: {
          include: {
            _count: { select: { members: { where: { removedAt: null } } } }
          }
        }
      },
      orderBy: { joinedAt: "asc" }
    });

    return memberships.map((membership) => this.toListItem(membership.workspace, membership.role));
  }

  /** 创建独立项目空间，并在同一事务内把创建者设为唯一 OWNER。 */
  async createWorkspace(userId: string, payload: WorkspaceCreateDto): Promise<WorkspaceListItem> {
    const name = this.requireName(payload?.name);
    const description = this.normalizeDescription(payload?.description);

    const workspace = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.workspace.create({
        data: { name, description, createdById: userId }
      });
      await transaction.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: WorkspaceRole.OWNER }
      });
      return created;
    });

    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      role: WorkspaceRole.OWNER,
      memberCount: 1,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    };
  }

  /** 返回当前成员可访问的项目空间详情。 */
  async getWorkspace(userId: string, workspaceId: string): Promise<WorkspaceListItem> {
    const membership = await this.requireMembership(userId, workspaceId);
    const memberCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, removedAt: null }
    });
    return this.toListItem(
      { ...membership.workspace, _count: { members: memberCount } },
      membership.role
    );
  }

  /** OWNER/ADMIN 可以修改项目空间基础资料，角色校验始终来自实时成员关系。 */
  async updateWorkspace(
    actorUserId: string,
    workspaceId: string,
    payload: WorkspaceUpdateDto
  ): Promise<WorkspaceListItem> {
    const actor = await this.requireRole(actorUserId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN
    ]);
    const data: Prisma.WorkspaceUpdateInput = {
      ...(payload.name !== undefined ? { name: this.requireName(payload.name) } : {}),
      ...(payload.description !== undefined
        ? { description: this.normalizeDescription(payload.description) }
        : {})
    };
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data
    });
    const memberCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, removedAt: null }
    });
    return this.toListItem({ ...workspace, _count: { members: memberCount } }, actor.role);
  }

  /** 只有 OWNER 可以软删除空间；业务资源清理在后续租户迁移阶段统一处理。 */
  async deleteWorkspace(actorUserId: string, workspaceId: string): Promise<void> {
    await this.requireRole(actorUserId, workspaceId, [WorkspaceRole.OWNER]);
    const resourceCounts = await Promise.all([
      this.prisma.agent.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.knowledgeBase.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.modelProvider.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.workflow.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.skill.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.httpTool.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.mcpServer.count({ where: { workspaceId, deletedAt: null } }),
      this.prisma.agentRun.count({ where: { workspaceId } })
    ]);
    if (resourceCounts.some((count) => count > 0)) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "项目空间仍包含业务资源，请先清理或迁移资源",
        HttpStatus.CONFLICT
      );
    }
    const deletedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt } }),
      this.prisma.workspaceMember.updateMany({
        where: { workspaceId, removedAt: null },
        data: { removedAt: deletedAt }
      })
    ]);
  }

  /** 项目空间成员可以查看同空间成员，不能枚举平台全局用户。 */
  async listMembers(userId: string, workspaceId: string): Promise<WorkspaceMemberListItem[]> {
    await this.requireMembership(userId, workspaceId);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, removedAt: null },
      include: { user: true },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }]
    });
    return members.map((member) => ({
      userId: member.userId,
      email: member.user.email,
      displayName: member.user.displayName,
      role: member.role,
      joinedAt: member.joinedAt
    }));
  }

  /** 创建或重新生成空间邀请；ADMIN 只能邀请 MEMBER，OWNER 可以邀请 ADMIN。 */
  async createInvitation(
    actorUserId: string,
    workspaceId: string,
    payload: WorkspaceInvitationCreateDto
  ): Promise<WorkspaceInvitationResponse> {
    const actor = await this.requireRole(actorUserId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN
    ]);
    const email = this.requireEmail(payload?.email);
    const displayName = this.requireDisplayName(payload?.displayName);
    const role = this.requireInvitationRole(payload?.role, actor.role);
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (existingUser) {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: existingUser.id } }
      });
      if (membership && !membership.removedAt) {
        throw new AppError(
          ErrorCodes.workspace.invitationConflict,
          "该用户已加入当前项目空间",
          HttpStatus.CONFLICT
        );
      }
    }

    const token = this.tokenService.createInvitationToken();
    const expiresAt = new Date(Date.now() + this.config.authInvitationTtlHours * 60 * 60 * 1000);
    const invitation = await this.prisma.userInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: {
        workspaceId,
        email,
        displayName,
        role,
        tokenHash: this.tokenService.hashInvitationToken(token),
        expiresAt,
        invitedByUserId: actorUserId
      },
      update: {
        displayName,
        role,
        tokenHash: this.tokenService.hashInvitationToken(token),
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
        invitedByUserId: actorUserId
      },
      include: { workspace: true }
    });

    return {
      id: invitation.id,
      workspaceId,
      workspaceName: invitation.workspace.name,
      email,
      role,
      activateUrl: this.createInvitationUrl(token),
      expiresAt
    };
  }

  /** OWNER/ADMIN 可以撤销当前空间尚未使用的邀请。 */
  async revokeInvitation(
    actorUserId: string,
    workspaceId: string,
    invitationId: string
  ): Promise<void> {
    await this.requireRole(actorUserId, workspaceId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    const result = await this.prisma.userInvitation.updateMany({
      where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (result.count !== 1) {
      throw this.notFound("项目空间邀请不存在");
    }
  }

  /** 修改成员角色；OWNER 不能通过通用接口产生或被修改。 */
  async updateMemberRole(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string,
    payload: WorkspaceMemberRoleUpdateDto
  ): Promise<void> {
    const actor = await this.requireRole(actorUserId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN
    ]);
    const target = await this.requireMembership(targetUserId, workspaceId);
    const role = payload?.role;
    if (role !== WorkspaceRole.ADMIN && role !== WorkspaceRole.MEMBER) {
      throw new AppError(ErrorCodes.common.badRequest, "成员角色不正确");
    }
    if (target.role === WorkspaceRole.OWNER || actor.role === WorkspaceRole.ADMIN) {
      throw this.forbidden("只有项目空间所有者可以调整管理员角色");
    }
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role }
    });
  }

  /** 移除成员只影响当前项目空间；OWNER 必须先转让所有权。 */
  async removeMember(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string
  ): Promise<void> {
    const actor = await this.requireRole(actorUserId, workspaceId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN
    ]);
    const target = await this.requireMembership(targetUserId, workspaceId);
    if (target.role === WorkspaceRole.OWNER) {
      throw new AppError(
        ErrorCodes.workspace.ownerRequired,
        "请先转让项目空间所有权",
        HttpStatus.CONFLICT
      );
    }
    if (actor.role === WorkspaceRole.ADMIN && target.role !== WorkspaceRole.MEMBER) {
      throw this.forbidden("管理员只能移除普通成员");
    }
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { removedAt: new Date() }
    });
  }

  /** OWNER 显式把所有权转给有效成员，旧 OWNER 原子降级为 ADMIN。 */
  async transferOwnership(
    actorUserId: string,
    workspaceId: string,
    payload: WorkspaceOwnershipTransferDto
  ): Promise<void> {
    await this.requireRole(actorUserId, workspaceId, [WorkspaceRole.OWNER]);
    const targetUserId = payload?.userId?.trim();
    if (!targetUserId || targetUserId === actorUserId) {
      throw new AppError(ErrorCodes.common.badRequest, "新的项目空间所有者不正确");
    }
    await this.requireMembership(targetUserId, workspaceId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
        data: { role: WorkspaceRole.ADMIN }
      });
      await transaction.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        data: { role: WorkspaceRole.OWNER }
      });
    });
  }

  /** Workspace Guard 使用的实时成员关系解析入口。 */
  async resolveCurrentWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<CurrentWorkspaceDto | null> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
        removedAt: null,
        workspace: { deletedAt: null }
      },
      include: { workspace: true }
    });
    return membership
      ? { id: workspaceId, name: membership.workspace.name, role: membership.role }
      : null;
  }

  private async requireMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
        removedAt: null,
        workspace: { deletedAt: null }
      },
      include: { workspace: true }
    });
    if (!membership) {
      throw this.notFound("项目空间不存在");
    }
    return membership;
  }

  private async requireRole(userId: string, workspaceId: string, roles: WorkspaceRole[]) {
    const membership = await this.requireMembership(userId, workspaceId);
    if (!roles.includes(membership.role)) {
      throw this.forbidden("没有权限管理当前项目空间");
    }
    return membership;
  }

  private toListItem(
    workspace: {
      id: string;
      name: string;
      description: string;
      createdAt: Date;
      updatedAt: Date;
      _count: { members: number };
    },
    role: WorkspaceRole
  ): WorkspaceListItem {
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      role,
      memberCount: workspace._count.members,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    };
  }

  private requireName(value: string | undefined): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 80) {
      throw new AppError(ErrorCodes.common.badRequest, "项目空间名称长度必须为 1-80 个字符");
    }
    return name;
  }

  private normalizeDescription(value: string | undefined): string {
    const description = typeof value === "string" ? value.trim() : "";
    if (description.length > 500) {
      throw new AppError(ErrorCodes.common.badRequest, "项目空间描述不能超过 500 个字符");
    }
    return description;
  }

  private requireEmail(value: string | undefined): string {
    const email = typeof value === "string" ? normalizeUserEmail(value) : "";
    if (!email || !/^\S+@\S+\.\S+$/u.test(email)) {
      throw new AppError(ErrorCodes.common.badRequest, "邮箱格式不正确");
    }
    return email;
  }

  private requireDisplayName(value: string | undefined): string {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 80) {
      throw new AppError(ErrorCodes.common.badRequest, "成员名称长度必须为 1-80 个字符");
    }
    return name;
  }

  private requireInvitationRole(
    role: WorkspaceRole | undefined,
    actorRole: WorkspaceRole
  ): WorkspaceRole {
    const normalized = role ?? WorkspaceRole.MEMBER;
    if (normalized === WorkspaceRole.OWNER) {
      throw new AppError(ErrorCodes.common.badRequest, "所有者必须通过所有权转让产生");
    }
    if (actorRole === WorkspaceRole.ADMIN && normalized !== WorkspaceRole.MEMBER) {
      throw this.forbidden("管理员只能邀请普通成员");
    }
    return normalized;
  }

  private createInvitationUrl(token: string): string {
    const url = new URL("/activate", this.config.publicBaseUrl);
    url.searchParams.set("token", token);
    return url.toString();
  }

  private notFound(message: string): AppError {
    return new AppError(ErrorCodes.workspace.notFound, message, HttpStatus.NOT_FOUND);
  }

  private forbidden(message: string): AppError {
    return new AppError(ErrorCodes.workspace.forbidden, message, HttpStatus.FORBIDDEN);
  }
}
