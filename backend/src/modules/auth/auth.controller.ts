import { Body, Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { getConfig } from "../../core/config";
import { Public } from "../../core/auth/public.decorator";
import { CurrentUser } from "../../core/auth/current-user.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  AcceptUserInvitationDto,
  AuthResponse,
  AuthSessionResponse,
  InvitationValidationResponse,
  LoginDto
} from "./dto/auth.dto";
import { AuthService } from "./auth.service";

const REFRESH_COOKIE_NAME = "mia_refresh_token";

@Controller("auth")
export class AuthController {
  private readonly config = getConfig();

  constructor(private readonly authService: AuthService) {}

  /**
   * 使用邮箱和密码创建当前设备会话。
   *
   * 长期 Refresh Token 仅写入 HttpOnly Cookie，响应体只包含短期 Access Token，
   * 因而前端业务代码无法读取或持久化长期凭证。
   */
  @Post("login")
  @Public()
  async login(
    @Body() payload: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    const session = await this.authService.login(payload, this.getRequestContext(request));
    this.writeRefreshCookie(response, session);
    return this.toAuthResponse(session);
  }

  /**
   * 使用 Cookie 中的 Refresh Token 轮换登录态。
   *
   * Cookie 缺失时统一由 AuthService 返回 401，Controller 不区分浏览器清理 Cookie
   * 与恶意请求，减少身份状态暴露。
   */
  @Post("refresh")
  @Public()
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    const session = await this.authService.refresh(
      this.readRefreshToken(request),
      this.getRequestContext(request)
    );
    this.writeRefreshCookie(response, session);
    return this.toAuthResponse(session);
  }

  /**
   * 撤销当前浏览器会话并删除 Refresh Cookie。
   *
   * 即使 Cookie 已经失效也应清除客户端副本，使退出操作对用户表现为可靠且幂等。
   */
  @Post("logout")
  @Public()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<null> {
    await this.authService.logout(this.readOptionalRefreshToken(request));
    response.clearCookie(REFRESH_COOKIE_NAME, this.getRefreshCookieOptions());
    return null;
  }

  /** 公开校验激活链接，激活页只在链接仍有效时才展示设置密码表单。 */
  @Get("invitations/validate")
  @Public()
  validateInvitation(
    @Query("token") token: string | undefined
  ): Promise<InvitationValidationResponse> {
    return this.authService.validateUserInvitation(token);
  }

  /**
   * 接受邀请后直接签发当前浏览器会话。
   *
   * 这样成员无需在激活成功后再次手动输入密码登录，Refresh Token 仍只通过 HttpOnly
   * Cookie 写入，保持与普通登录一致的安全边界。
   */
  @Post("invitations/accept")
  @Public()
  async acceptInvitation(
    @Body() payload: AcceptUserInvitationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<AuthResponse> {
    const session = await this.authService.acceptUserInvitation(
      payload,
      this.getRequestContext(request)
    );
    this.writeRefreshCookie(response, session);
    return this.toAuthResponse(session);
  }

  /**
   * 返回 Guard 已验证的当前用户公开资料。
   *
   * 此接口不再读取密码、Session 或 JWT 原始 Payload，前端只用它恢复展示名和当前角色。
   */
  @Get("me")
  getCurrentUser(@CurrentUser() currentUser: CurrentUserDto): CurrentUserDto {
    return currentUser;
  }

  /**
   * 撤销当前用户在所有设备上的 Refresh Session。
   *
   * 当前 Cookie 同时被清除，因此该操作执行后本设备也必须重新登录；短期 Access Token
   * 会被 Guard 的用户状态校验限制在自然过期前的极小窗口内。
   */
  @Post("logout-all")
  async logoutAll(
    @CurrentUser() currentUser: CurrentUserDto,
    @Res({ passthrough: true }) response: Response
  ): Promise<null> {
    await this.authService.revokeAllUserSessions(currentUser.id);
    response.clearCookie(REFRESH_COOKIE_NAME, this.getRefreshCookieOptions());
    return null;
  }

  /**
   * 从请求头提取仅用于审计的来源信息。
   *
   * IP 与 User-Agent 不参与权限判断，且长度受限，避免不可信请求头无限写入数据库。
   */
  private getRequestContext(request: Request): {
    ipAddress: string | null;
    userAgent: string | null;
  } {
    const forwardedFor = request.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(",")[0]?.trim();
    const userAgent = request.headers["user-agent"];

    return {
      ipAddress: (forwardedIp || request.ip || null)?.slice(0, 128) ?? null,
      userAgent: userAgent?.slice(0, 1024) ?? null
    };
  }

  /** 读取必需的 Refresh Cookie；缺失时交给统一的未登录响应处理。 */
  private readRefreshToken(request: Request): string {
    return this.readOptionalRefreshToken(request) ?? "";
  }

  /**
   * 从原始 Cookie Header 中读取 Refresh Token。
   *
   * v1 避免为一个 Cookie 引入全局解析中间件；Token 为 base64url 字符串，解码失败时
   * 视为不存在，后续统一返回未登录。
   */
  private readOptionalRefreshToken(request: Request): string | null {
    const cookieHeader = request.headers.cookie ?? "";
    const cookie = cookieHeader
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${REFRESH_COOKIE_NAME}=`));

    if (!cookie) {
      return null;
    }

    try {
      return decodeURIComponent(cookie.slice(`${REFRESH_COOKIE_NAME}=`.length));
    } catch {
      return null;
    }
  }

  /**
   * 写入 Refresh Cookie 的统一选项。
   *
   * Path 被限制在 auth API，减少 Cookie 在无关业务请求中携带的范围；生产环境由配置
   * 强制启用 Secure，禁止长期 Token 通过明文 HTTP 发送。
   */
  private getRefreshCookieOptions(): {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
  } {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.authCookieSecure,
      path: "/api/v1/auth"
    };
  }

  /** 将新 Session 的长期 Token 放入 Cookie，并使用服务端过期时间保持两端一致。 */
  private writeRefreshCookie(response: Response, session: AuthSessionResponse): void {
    response.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
      ...this.getRefreshCookieOptions(),
      expires: session.refreshExpiresAt
    });
  }

  /** 去除仅供 Controller 使用的 Refresh 字段，保证 API 响应不会泄漏长期凭证。 */
  private toAuthResponse(session: AuthSessionResponse): AuthResponse {
    return {
      accessToken: session.accessToken,
      expiresInSeconds: session.expiresInSeconds,
      user: session.user
    };
  }
}
