import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { sign, verify } from "jsonwebtoken";

import { getConfig } from "../../core/config";
import { AccessTokenPayload } from "./dto/auth.dto";

@Injectable()
export class TokenService {
  private readonly config = getConfig();

  /**
   * 签发短期 Access Token。
   *
   * 只携带 Guard 需要的稳定身份字段，避免把数据库敏感字段或权限详情塞进可被客户端
   * 读取的 JWT；实际访问时 Guard 仍会确认用户未被禁用。
   */
  signAccessToken(payload: AccessTokenPayload): string {
    return sign(payload, this.config.authJwtSecret, {
      algorithm: "HS256",
      expiresIn: this.config.authAccessTokenTtlSeconds
    });
  }

  /**
   * 验证并解析 Access Token。
   *
   * 签名、算法或过期校验失败会直接抛出，Guard 统一转换为未登录响应，避免不同 JWT
   * 失败原因成为探测入口。
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = verify(token, this.config.authJwtSecret, {
      algorithms: ["HS256"]
    });

    return payload as AccessTokenPayload;
  }

  /**
   * 生成高熵、不可预测的 Refresh Token。
   *
   * Refresh Token 不是 JWT，因此服务端可以只存哈希并在轮换或注销时逐条撤销。
   */
  createRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  /**
   * 生成 Refresh Token 的数据库索引值。
   *
   * SHA-256 只用于把随机高熵 Token 转为不可直接复用的存储值，不用于密码哈希。
   */
  hashRefreshToken(refreshToken: string): string {
    return createHash("sha256").update(refreshToken).digest("hex");
  }

  /**
   * 计算新 Refresh Session 的失效时间。
   *
   * 使用配置项而非 Cookie 固定值，确保服务端校验和浏览器 Cookie 生命周期保持一致。
   */
  getRefreshExpiresAt(now = new Date()): Date {
    return new Date(now.getTime() + this.config.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }

  /** 返回 Access Token 的秒级有效期，供前端安排主动刷新。 */
  getAccessTokenTtlSeconds(): number {
    return this.config.authAccessTokenTtlSeconds;
  }
}
