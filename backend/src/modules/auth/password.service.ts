import { HttpStatus, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

import { AppError, ErrorCodes } from "../../core/errors";

@Injectable()
export class PasswordService {
  /**
   * 校验新密码是否满足 v1 的基础强度要求。
   *
   * 规则保持简单可执行：至少 12 位且同时包含字母与数字；密码策略只在设置密码时失败，
   * 登录时绝不把策略细节暴露给匿名调用方。
   */
  validatePasswordStrength(password: string): void {
    if (
      password.length < 12 ||
      !/[a-zA-Z]/u.test(password) ||
      !/[0-9]/u.test(password)
    ) {
      throw new AppError(
        ErrorCodes.auth.invalidPassword,
        "密码至少需要 12 位，并同时包含字母和数字",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * 使用 Argon2id 生成不可逆密码哈希。
   *
   * Argon2id 同时覆盖离线猜测与侧信道风险；参数由库安全默认值管理，禁止改用可逆加密
   * 或快速哈希算法保存用户密码。
   */
  async hashPassword(password: string): Promise<string> {
    this.validatePasswordStrength(password);

    return argon2.hash(password, {
      type: argon2.argon2id
    });
  }

  /**
   * 验证登录密码与已存哈希是否匹配。
   *
   * 无效哈希或算法异常统一视为验证失败，调用方使用统一登录错误，避免泄漏账号或
   * 存储状态细节。
   */
  async verifyPassword(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
