import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, User, UserRole } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserInput, CurrentUserDto, UserAuthRecord } from "./dto/user.dto";

type UserAuthSelection = Pick<
  User,
  "id" | "email" | "displayName" | "passwordHash" | "role" | "disabledAt"
>;

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
