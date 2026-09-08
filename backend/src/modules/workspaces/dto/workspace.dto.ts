import { WorkspaceRole } from "@prisma/client";

/** 当前用户可访问的项目空间摘要和空间内角色。 */
export type WorkspaceListItem = {
  /** 项目空间 ID，也是业务请求使用的租户键。 */
  id: string;
  /** 项目空间展示名称。 */
  name: string;
  /** 项目空间用途说明。 */
  description: string;
  /** 当前用户在该空间内的角色。 */
  role: WorkspaceRole;
  /** 当前有效成员数量。 */
  memberCount: number;
  /** ISO 格式创建时间。 */
  createdAt: Date;
  /** ISO 格式最近更新时间。 */
  updatedAt: Date;
};

/** 创建项目空间的输入；创建者自动成为唯一 OWNER。 */
export type WorkspaceCreateDto = {
  /** 项目空间名称。 */
  name?: string;
  /** 项目空间用途说明。 */
  description?: string;
};

/** 更新项目空间资料的输入。 */
export type WorkspaceUpdateDto = {
  /** 新项目空间名称。 */
  name?: string;
  /** 新用途说明。 */
  description?: string;
};

/** 项目空间成员列表项。 */
export type WorkspaceMemberListItem = {
  /** 全局用户 ID。 */
  userId: string;
  /** 登录邮箱。 */
  email: string;
  /** 展示名称。 */
  displayName: string;
  /** 在当前项目空间内的角色。 */
  role: WorkspaceRole;
  /** 加入当前空间的时间。 */
  joinedAt: Date;
};

/** 邀请用户加入当前项目空间的输入。 */
export type WorkspaceInvitationCreateDto = {
  /** 被邀请邮箱；已有账号和新账号均支持。 */
  email?: string;
  /** 新账号激活页使用的展示名称。 */
  displayName?: string;
  /** OWNER 不能通过邀请产生，只允许 ADMIN 或 MEMBER。 */
  role?: WorkspaceRole;
};

/** 创建或重新生成项目空间邀请后的响应。 */
export type WorkspaceInvitationResponse = {
  /** 邀请记录 ID。 */
  id: string;
  /** 目标项目空间 ID。 */
  workspaceId: string;
  /** 目标项目空间名称。 */
  workspaceName: string;
  /** 被邀请邮箱。 */
  email: string;
  /** 加入后的空间角色。 */
  role: WorkspaceRole;
  /** 仅创建或重新生成时返回的一次性激活链接。 */
  activateUrl: string;
  /** 邀请失效时间。 */
  expiresAt: Date;
};

/** 修改项目空间成员角色的输入。 */
export type WorkspaceMemberRoleUpdateDto = {
  /** 新角色；OWNER 必须使用单独的所有权转让接口。 */
  role?: WorkspaceRole;
};

/** 转让项目空间所有权的输入。 */
export type WorkspaceOwnershipTransferDto = {
  /** 必须是当前空间内的有效成员。 */
  userId?: string;
};

/** Guard 校验后挂载到请求上的可信项目空间上下文。 */
export type CurrentWorkspaceDto = {
  /** 当前项目空间 ID。 */
  id: string;
  /** 当前项目空间名称。 */
  name: string;
  /** 当前用户在该空间内的实时角色。 */
  role: WorkspaceRole;
};
