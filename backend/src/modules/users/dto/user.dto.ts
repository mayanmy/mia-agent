import { UserRole } from "@prisma/client";

/** 允许在认证模块内部使用的用户认证信息，禁止直接返回给 API 调用方。 */
export type UserAuthRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  disabledAt: Date | null;
};

/** 返回给前端或其他业务模块的当前用户信息，不包含密码与会话凭证。 */
export type CurrentUserDto = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

/** 由管理员初始化或成员管理流程传入的内部创建参数。 */
export type CreateUserInput = {
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
};

/** 成员管理列表的分页和关键词筛选。 */
export type UserQueryDto = {
  page?: string;
  pageSize?: string;
  keyword?: string;
};

/** 成员管理列表中的状态和时间摘要。 */
export type UserListItem = CurrentUserDto & {
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
};

/** 管理员直接创建成员时的输入。 */
export type CreateManagedUserDto = {
  email?: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
};

/** 管理员更新成员资料、角色和启用状态的输入。 */
export type UpdateManagedUserDto = {
  displayName?: string;
  role?: UserRole;
  enabled?: boolean;
};

/** 管理员重置成员密码的输入。 */
export type ResetUserPasswordDto = { password?: string };
