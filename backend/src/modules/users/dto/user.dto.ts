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

export type UserQueryDto = {
  page?: string;
  pageSize?: string;
  keyword?: string;
};

export type UserListItem = CurrentUserDto & {
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date;
};

export type CreateManagedUserDto = {
  email?: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
};

export type UpdateManagedUserDto = {
  displayName?: string;
  role?: UserRole;
  enabled?: boolean;
};

export type ResetUserPasswordDto = { password?: string };
