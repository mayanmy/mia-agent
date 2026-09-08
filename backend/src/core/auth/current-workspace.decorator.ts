import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { CurrentWorkspaceDto } from "../../modules/workspaces/dto/workspace.dto";
import { AuthenticatedRequest } from "./auth.types";

/** 读取 WorkspaceGuard 已验证的项目空间上下文，禁止直接从 Header 构造。 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentWorkspaceDto => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.currentWorkspace) {
      throw new Error("CurrentWorkspace 只能用于要求项目空间的受保护路由");
    }
    return request.currentWorkspace;
  }
);
