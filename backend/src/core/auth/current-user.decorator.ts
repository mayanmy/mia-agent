import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { CurrentUserDto } from "../../modules/users/dto/user.dto";
import { AuthenticatedRequest } from "./auth.types";

/**
 * 读取 JWT Guard 已验证的当前用户。
 *
 * Controller 只依赖稳定的用户 DTO，而不是自行解析 Authorization Header，
 * 这样 Chat、日志等模块不会出现各自不同的身份判断逻辑。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserDto => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return request.currentUser as CurrentUserDto;
  }
);
