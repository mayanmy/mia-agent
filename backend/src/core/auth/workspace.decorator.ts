import { SetMetadata } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";

/** 标记路由必须提供并验证当前项目空间。 */
export const WORKSPACE_REQUIRED_KEY = "mia:workspace-required";
export const WorkspaceRequired = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(WORKSPACE_REQUIRED_KEY, true);

/** 声明项目空间内允许访问的角色；使用该装饰器会自动要求 Workspace 上下文。 */
export const WORKSPACE_ROLES_KEY = "mia:workspace-roles";
export const WorkspaceRoles = (...roles: WorkspaceRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);
