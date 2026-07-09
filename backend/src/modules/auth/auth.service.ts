import { HttpStatus, Injectable } from "@nestjs/common";
import { User } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService, normalizeUserEmail } from "../users/users.service";
import {
  CreateManagedUserDto,
  CurrentUserDto,
  ResetUserPasswordDto,
  UpdateManagedUserDto,
  UserListItem,
  UserQueryDto
} from "../users/dto/user.dto";
import { PageResult } from "../../core/result";
import { AuthRequestContext, AuthSessionResponse, AuthResponse, LoginDto } from "./dto/auth.dto";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService
  ) {}

  /**
   * 验证邮箱密码并创建当前设备的 Refresh Session。
   *
   * 账号不存在、已禁用和密码错误统一返回同一个未登录错误，防止外部通过错误文案枚举
   * 团队成员邮箱。
   */
  async login(payload: LoginDto, context: AuthRequestContext): Promise<AuthSessionResponse> {
    const email = this.requireLoginEmail(payload?.email);
    const password = this.requireLoginPassword(payload?.password);
    const user = await this.usersService.findActiveUserByEmail(email);
    const passwordMatched = user
      ? await this.passwordService.verifyPassword(user.passwordHash, password)
      : false;

    if (!user || !passwordMatched) {
      throw this.createInvalidCredentialsError();
    }

    await this.usersService.recordSuccessfulLogin(user.id);
    return this.createSessionResponse(user, context);
  }

  /**
   * 轮换当前设备的 Refresh Session 并签发新的 Access Token。
   *
   * 旧 Session 必须在同一事务内标记撤销后才创建新 Session，防止同一个 Refresh Token
   * 被并发重放而产生多个有效会话。
   */
  async refresh(refreshToken: string, context: AuthRequestContext): Promise<AuthSessionResponse> {
    const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true }
    });
    const now = new Date();

    if (!session || session.revokedAt || session.expiresAt <= now || session.user.disabledAt) {
      throw this.createInvalidSessionError();
    }

    const nextRefreshToken = this.tokenService.createRefreshToken();
    const nextExpiresAt = this.tokenService.getRefreshExpiresAt(now);

    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: { revokedAt: now }
      });

      if (revoked.count !== 1) {
        throw this.createInvalidSessionError();
      }

      await transaction.authSession.create({
        data: {
          userId: session.userId,
          refreshTokenHash: this.tokenService.hashRefreshToken(nextRefreshToken),
          expiresAt: nextExpiresAt,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent
        }
      });
    });

    return this.toSessionResponse(session.user, nextRefreshToken, nextExpiresAt);
  }

  /**
   * 撤销当前 Refresh Session。
   *
   * 退出接口保持幂等：Cookie 已失效或不存在时也返回成功，前端可以放心在清理登录态时调用。
   */
  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) {
      return;
    }

    await this.prisma.authSession.updateMany({
      where: {
        refreshTokenHash: this.tokenService.hashRefreshToken(refreshToken),
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });
  }

  /**
   * 撤销指定用户的全部可用会话。
   *
   * 禁用账号、重置密码和“退出全部设备”都复用此方法，避免遗漏某一种长期凭证。
   */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });
  }

  /** 管理员创建成员时在 auth 模块完成明文密码哈希，再委托 users 模块保存资料。 */
  async createManagedUser(payload: CreateManagedUserDto): Promise<CurrentUserDto> {
    const email = this.requireManagedEmail(payload.email);
    const displayName = this.requireDisplayName(payload.displayName);
    const password = this.requireManagedPassword(payload.password);
    return this.usersService.createUser({
      email,
      displayName,
      passwordHash: await this.passwordService.hashPassword(password),
      role: payload.role ?? "USER"
    });
  }

  /** 查询成员列表；认证模块作为管理编排入口，users 模块保持为纯用户数据服务。 */
  async listManagedUsers(query: UserQueryDto): Promise<PageResult<UserListItem>> {
    return this.usersService.listUsers(query);
  }

  /**
   * 修改成员资料，禁用成员后立即撤销其 Refresh Session。
   *
   * Guard 每次请求还会读取 disabledAt，因此短期 Access Token 也无法继续访问内部接口。
   */
  async updateManagedUser(id: string, payload: UpdateManagedUserDto): Promise<UserListItem> {
    const user = await this.usersService.updateManagedUser(id, payload);
    if (payload.enabled === false) {
      await this.revokeAllUserSessions(id);
    }
    return user;
  }

  /** 重置成员密码并撤销其全部会话，防止旧设备继续以原密码对应的 Session 访问。 */
  async resetManagedUserPassword(id: string, payload: ResetUserPasswordDto): Promise<void> {
    const password = this.requireManagedPassword(payload.password);
    await this.usersService.updatePasswordHash(
      id,
      await this.passwordService.hashPassword(password)
    );
    await this.revokeAllUserSessions(id);
  }

  /** 撤销指定成员全部会话前先确认其存在，避免管理员误操作时得到静默成功。 */
  async revokeManagedUserSessions(id: string): Promise<void> {
    await this.usersService.ensureUserExists(id);
    await this.revokeAllUserSessions(id);
  }

  /**
   * 创建登录响应与服务端 Session。
   *
   * Refresh Token 只返回给 Controller 用于写 HttpOnly Cookie，业务响应中不会序列化它。
   */
  private async createSessionResponse(
    user: Pick<User, "id" | "email" | "displayName" | "role">,
    context: AuthRequestContext
  ): Promise<AuthSessionResponse> {
    const refreshToken = this.tokenService.createRefreshToken();
    const refreshExpiresAt = this.tokenService.getRefreshExpiresAt();

    await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: this.tokenService.hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      }
    });

    return this.toSessionResponse(user, refreshToken, refreshExpiresAt);
  }

  /**
   * 组装前端登录态与仅供 Controller 写 Cookie 的 Refresh Token。
   *
   * 该转换集中处理，确保密码哈希、Session ID 等数据库字段永远不会进入 API 响应。
   */
  private toSessionResponse(
    user: Pick<User, "id" | "email" | "displayName" | "role">,
    refreshToken: string,
    refreshExpiresAt: Date
  ): AuthSessionResponse {
    const authResponse: AuthResponse = {
      accessToken: this.tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role
      }),
      expiresInSeconds: this.tokenService.getAccessTokenTtlSeconds(),
      user: this.usersService.toCurrentUser(user)
    };

    return {
      ...authResponse,
      refreshToken,
      refreshExpiresAt
    };
  }

  /** 验证登录邮箱的基本格式，避免把空值或明显错误输入传入数据库查询。 */
  private requireLoginEmail(email: string | undefined): string {
    const normalizedEmail = typeof email === "string" ? normalizeUserEmail(email) : "";

    if (!normalizedEmail || !/^\S+@\S+\.\S+$/u.test(normalizedEmail)) {
      throw this.createInvalidCredentialsError();
    }

    return normalizedEmail;
  }

  /** 验证登录密码是否存在；不在登录阶段执行强度校验，兼容未来密码策略升级后的旧密码。 */
  private requireLoginPassword(password: string | undefined): string {
    if (typeof password !== "string" || password.length === 0) {
      throw this.createInvalidCredentialsError();
    }

    return password;
  }

  /** 校验管理员创建成员时的邮箱，创建流程可返回明确参数错误而非匿名登录错误。 */
  private requireManagedEmail(email: string | undefined): string {
    const normalizedEmail = typeof email === "string" ? normalizeUserEmail(email) : "";
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/u.test(normalizedEmail)) {
      throw new AppError(ErrorCodes.common.badRequest, "邮箱格式不正确", HttpStatus.BAD_REQUEST);
    }
    return normalizedEmail;
  }

  /** 校验成员展示名，避免空白名称导致成员列表与审计日志不可读。 */
  private requireDisplayName(displayName: string | undefined): string {
    const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
    if (!normalizedName) {
      throw new AppError(ErrorCodes.common.badRequest, "成员名称不能为空", HttpStatus.BAD_REQUEST);
    }
    return normalizedName;
  }

  /** 校验管理员设置的密码存在；具体强度规则由 PasswordService 统一执行。 */
  private requireManagedPassword(password: string | undefined): string {
    if (typeof password !== "string" || !password) {
      throw new AppError(ErrorCodes.common.badRequest, "密码不能为空", HttpStatus.BAD_REQUEST);
    }
    return password;
  }

  /** 创建统一的匿名登录失败错误，避免泄露账号状态或密码校验细节。 */
  private createInvalidCredentialsError(): AppError {
    return new AppError(
      ErrorCodes.auth.invalidCredentials,
      "邮箱或密码错误，或账号已被禁用",
      HttpStatus.UNAUTHORIZED
    );
  }

  /** 创建统一的 Refresh Session 失败错误，避免暴露 Token 是否曾经存在。 */
  private createInvalidSessionError(): AppError {
    return new AppError(ErrorCodes.auth.invalidSession, "登录状态已失效", HttpStatus.UNAUTHORIZED);
  }
}
