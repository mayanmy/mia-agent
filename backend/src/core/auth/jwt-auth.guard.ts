import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { AppError, ErrorCodes } from "../errors";
import { TokenService } from "../../modules/auth/token.service";
import { UsersService } from "../../modules/users/users.service";
import { AuthenticatedRequest } from "./auth.types";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService
  ) {}

  /**
   * 验证请求中的短期 Access Token，并加载当前仍有效的用户资料。
   *
   * 路由默认要求登录，只有显式 @Public() 才能绕过。验证 JWT 后仍查询用户状态，
   * 因此管理员禁用账号或调整角色不必等待旧 Token 自然过期。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw this.createUnauthorizedError();
    }

    try {
      const payload = this.tokenService.verifyAccessToken(token);
      const user = await this.usersService.findActiveCurrentUser(payload.sub);

      if (!user) {
        throw this.createUnauthorizedError();
      }

      request.currentUser = user;
      return true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw this.createUnauthorizedError();
    }
  }

  /**
   * 从标准 Bearer Header 提取 Access Token。
   *
   * 只接受单一、非空的 Bearer 格式，避免把 Cookie、查询参数或多段 Header 当作登录凭证。
   */
  private extractBearerToken(authorization: string | undefined): string | null {
    if (!authorization) {
      return null;
    }

    const [scheme, token, ...rest] = authorization.trim().split(/\s+/u);

    if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
      return null;
    }

    return token;
  }

  /** 返回统一未登录错误，防止 Token 失败原因成为可枚举信息。 */
  private createUnauthorizedError(): AppError {
    return new AppError(
      ErrorCodes.common.unauthorized,
      "未登录或登录状态已失效",
      HttpStatus.UNAUTHORIZED
    );
  }
}
