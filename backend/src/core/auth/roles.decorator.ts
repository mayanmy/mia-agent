import { SetMetadata } from "@nestjs/common";
import { UserRole } from "@prisma/client";

/** 指定路由允许访问的角色；未声明时只要求用户已登录。 */
export const ROLES_KEY = "mia:roles";
export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
