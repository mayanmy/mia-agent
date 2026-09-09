import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WorkspaceRole } from "@prisma/client";

import { WorkspacesService } from "../../modules/workspaces/workspaces.service";
import { AppError, ErrorCodes } from "../errors";
import { AuthenticatedRequest } from "./auth.types";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { WORKSPACE_REQUIRED_KEY, WORKSPACE_ROLES_KEY } from "./workspace.decorator";

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly workspacesService: WorkspacesService
  ) {}

  /** 对声明了 Workspace 的路由解析 Header，并实时确认当前用户仍是有效成员。 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, targets);
    const required =
      Boolean(roles?.length) ||
      Boolean(this.reflector.getAllAndOverride<boolean>(WORKSPACE_REQUIRED_KEY, targets));
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.currentUser) {
      throw new AppError(ErrorCodes.common.unauthorized, "未登录", HttpStatus.UNAUTHORIZED);
    }
    const workspaceId = this.readWorkspaceId(request.headers["x-workspace-id"]);
    if (!workspaceId) {
      throw new AppError(
        ErrorCodes.workspace.required,
        "请选择项目空间后重试",
        HttpStatus.BAD_REQUEST
      );
    }
    const workspace = await this.workspacesService.resolveCurrentWorkspace(
      request.currentUser.id,
      workspaceId
    );
    if (!workspace) {
      throw new AppError(
        ErrorCodes.workspace.notFound,
        "项目空间不存在或已无访问权限",
        HttpStatus.NOT_FOUND
      );
    }
    request.currentWorkspace = workspace;
    return true;
  }

  private readWorkspaceId(value: string | string[] | undefined): string | null {
    const workspaceId = Array.isArray(value) ? value[0] : value;
    if (
      !workspaceId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        workspaceId
      )
    ) {
      return null;
    }
    return workspaceId;
  }
}

@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 使用 WorkspaceGuard 写入的实时角色执行空间内授权。 */
  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, targets);
    if (!roles?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.currentWorkspace || !roles.includes(request.currentWorkspace.role)) {
      throw new AppError(
        ErrorCodes.workspace.forbidden,
        "没有权限访问当前项目空间资源",
        HttpStatus.FORBIDDEN
      );
    }
    return true;
  }
}
