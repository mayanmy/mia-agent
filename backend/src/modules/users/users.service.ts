import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, User } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { createPageResult, normalizePageQuery } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateUserInput,
  CurrentUserDto,
  UpdateManagedUserDto,
  UserAuthRecord,
  UserListItem,
  UserQueryDto
} from "./dto/user.dto";

/**
 * 将邮箱收敛为唯一、稳定的数据库键。
 *
 * PostgreSQL 的普通 TEXT 唯一索引区分大小写，因此所有用户读写都必须经过此函数，
 * 避免 `Admin@Example.com` 与 `admin@example.com` 变成两个账号。
 */
export function normalizeUserEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建内部用户记录。
   *
   * 密码哈希由 auth 模块生成后传入，users 模块不接触明文密码，避免用户管理逻辑
   * 与具体密码算法耦合。
   */
  async createUser(input: CreateUserInput): Promise<CurrentUserDto> {
    const email = normalizeUserEmail(input.email);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          displayName: input.displayName.trim(),
          passwordHash: input.passwordHash,
          role: input.role
        }
      });

      return this.toCurrentUser(user);
    } catch (error) {
      if (this.isUniqueEmailError(error)) {
        throw new AppError(ErrorCodes.user.emailExists, "邮箱已存在", HttpStatus.CONFLICT);
      }

      throw error;
    }
  }

  /**
   * 按邮箱读取可用于登录的账号。
   *
   * 禁用账号被当作不存在处理，调用方统一返回登录失败，避免通过接口判断某个邮箱是否存在。
   */
  async findActiveUserByEmail(email: string): Promise<UserAuthRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: normalizeUserEmail(email),
        disabledAt: null
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordHash: true,
        role: true,
        disabledAt: true
      }
    });

    return user;
  }

  /**
   * 查询邮箱是否已被正式成员占用。
   *
   * 邀请记录不会预创建 User，因此管理员生成链接前必须先检查这里，避免成员接受邀请时
   * 才因邮箱冲突失败。该方法只返回存在性所需的 ID，不暴露账号敏感字段。
   */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeUserEmail(email) },
      select: { id: true }
    });

    return user?.id ?? null;
  }

  /**
   * 按 ID 获取仍可访问工作台的用户公开信息。
   *
   * Guard 和 Refresh 流程都依赖此检查，因此禁用操作不必等待旧 Access Token 自然过期。
   */
  async findActiveCurrentUser(id: string): Promise<CurrentUserDto | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        disabledAt: null
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true
      }
    });

    return user ? this.toCurrentUser(user) : null;
  }

  /**
   * 记录成功登录时间。
   *
   * 该字段只在密码登录成功后更新，刷新 Access Token 不更新，避免把无感续期误判为人工登录。
   */
  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() }
    });
  }

  /** 管理员分页查询成员；关键词仅匹配邮箱和展示名，避免提供密码等敏感字段的检索入口。 */
  async listUsers(query: UserQueryDto): Promise<PageResult<UserListItem>> {
    const page = normalizePageQuery(query);
    const keyword = query.keyword?.trim();
    const where = keyword
      ? {
          OR: [
            { email: { contains: keyword, mode: "insensitive" as const } },
            { displayName: { contains: keyword, mode: "insensitive" as const } }
          ]
        }
      : {};
    // 成员列表与总数共用同一事务快照，保证管理员分页展示口径一致。
    const [list, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take
      }),
      this.prisma.user.count({ where })
    ]);

    return createPageResult(
      list.map((user) => ({
        ...this.toCurrentUser(user),
        lastLoginAt: user.lastLoginAt,
        disabledAt: user.disabledAt,
        createdAt: user.createdAt
      })),
      total,
      page.page,
      page.pageSize
    );
  }

  /**
   * 更新成员显示名、角色或启用状态。
   *
   * 不允许将最后一个可用管理员降级或禁用，否则团队会失去恢复权限的入口。
   */
  async updateManagedUser(id: string, payload: UpdateManagedUserDto): Promise<UserListItem> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new AppError(ErrorCodes.user.notFound, "用户不存在", HttpStatus.NOT_FOUND);
    }

    const willRemainAdmin = (payload.role ?? user.role) === "ADMIN" && payload.enabled !== false;

    if (user.role === "ADMIN" && !user.disabledAt && !willRemainAdmin) {
      const activeAdminCount = await this.prisma.user.count({
        where: { role: "ADMIN", disabledAt: null }
      });
      if (activeAdminCount <= 1) {
        throw new AppError(
          ErrorCodes.common.conflict,
          "至少需要保留一个可用管理员",
          HttpStatus.CONFLICT
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(payload.displayName !== undefined ? { displayName: payload.displayName.trim() } : {}),
        ...(payload.role !== undefined ? { role: payload.role } : {}),
        ...(payload.enabled !== undefined
          ? { disabledAt: payload.enabled ? null : new Date() }
          : {})
      }
    });

    return {
      ...this.toCurrentUser(updated),
      lastLoginAt: updated.lastLoginAt,
      disabledAt: updated.disabledAt,
      createdAt: updated.createdAt
    };
  }

  /** 更新密码哈希；调用方必须先完成强度校验和哈希，users 模块不处理明文密码。 */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() }
    });
    if (result.count !== 1) {
      throw new AppError(ErrorCodes.user.notFound, "用户不存在", HttpStatus.NOT_FOUND);
    }
  }

  /** 确认成员记录存在，供不修改用户表的会话管理操作返回正确的 404 语义。 */
  async ensureUserExists(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) {
      throw new AppError(ErrorCodes.user.notFound, "用户不存在", HttpStatus.NOT_FOUND);
    }
  }

  /**
   * 将数据库用户记录转换为可跨模块传递的公开 DTO。
   *
   * 统一转换可以防止 passwordHash 在 Controller 或日志中被意外返回。
   */
  toCurrentUser(user: Pick<User, "id" | "email" | "displayName" | "role">): CurrentUserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role
    };
  }

  /**
   * 识别邮箱唯一索引冲突。
   *
   * Prisma 错误类型在不同调用场景可能被包装，因此只把明确的 P2002 映射为业务冲突，
   * 其余数据库错误继续抛出，避免掩盖真实故障。
   */
  private isUniqueEmailError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
