/** 项目空间内固定角色。 */
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

/** 当前账号可访问的项目空间摘要。 */
export type WorkspaceListItem = {
  /** 项目空间 ID，也是请求 Header 使用的租户键。 */
  id: string;
  /** 项目空间展示名称。 */
  name: string;
  /** 项目空间用途说明。 */
  description: string;
  /** 当前账号在该空间内的角色。 */
  role: WorkspaceRole;
  /** 当前有效成员数量。 */
  memberCount: number;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式最近更新时间。 */
  updatedAt: string;
};

/** 当前项目空间内的成员。 */
export type WorkspaceMember = {
  /** 成员的全局用户 ID。 */
  userId: string;
  /** 成员登录邮箱。 */
  email: string;
  /** 成员展示名称。 */
  displayName: string;
  /** 成员在当前空间内的角色。 */
  role: WorkspaceRole;
  /** ISO 格式加入时间。 */
  joinedAt: string;
};

/** 创建或重新生成邀请后唯一一次返回的激活链接。 */
export type WorkspaceInvitation = {
  /** 邀请记录 ID。 */
  id: string;
  /** 目标项目空间 ID。 */
  workspaceId: string;
  /** 目标项目空间名称。 */
  workspaceName: string;
  /** 被邀请邮箱。 */
  email: string;
  /** 接受邀请后获得的空间角色。 */
  role: WorkspaceRole;
  /** 一次性激活链接。 */
  activateUrl: string;
  /** ISO 格式失效时间。 */
  expiresAt: string;
};
