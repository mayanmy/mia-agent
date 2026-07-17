import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";

type RateLimitWindow = {
  count: number;
  resetAt: number;
};

/**
 * v1 的轻量进程内限流器。
 *
 * Mia 当前为单实例本地部署，按分钟窗口即可阻挡误触发和公开 Widget 的基础滥用；未来多实例
 * 部署时替换为 Redis 实现，Controller 和业务接口无需变化。
 */
@Injectable()
export class ExternalRateLimiterService {
  private readonly windows = new Map<string, RateLimitWindow>();

  /** 在固定一分钟窗口内消费一次配额；超过上限时在模型调用前直接失败。 */
  assertAllowed(scope: string, identifier: string, limit: number): void {
    const now = Date.now();
    const key = `${scope}:${this.hashIdentifier(identifier)}`;
    const current = this.windows.get(key);

    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }

    if (current.count >= limit) {
      throw new AppError(
        ErrorCodes.externalAccess.rateLimited,
        "请求过于频繁，请稍后再试",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    current.count += 1;
  }

  /** 对限流维度哈希，避免内存状态和诊断信息留下原始 user 或 sessionId。 */
  private hashIdentifier(value: string): string {
    // 不在进程内 Map 保留原始 sessionId、业务 user 或 API Key，降低调试转储泄露风险。
    return createHash("sha256").update(value).digest("hex");
  }
}
