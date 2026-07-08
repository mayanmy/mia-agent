import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";

import { AppError, ErrorCodes } from "../errors";
import { AuthenticatedRequest } from "./auth.types";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * 校验已登录用户是否拥有路由声明的角色。
   *
   * 没有 @Roles() 的内部路由仅要求登录；公开路由直接跳过，保持认证与授权两个 Guard 的
   * 行为一致，避免公开健康检查被角色 Guard 二次拦截。
   */
  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.currentUser || !roles.includes(request.currentUser.role)) {
      throw new AppError(ErrorCodes.common.forbidden, "没有权限访问此资源", HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
