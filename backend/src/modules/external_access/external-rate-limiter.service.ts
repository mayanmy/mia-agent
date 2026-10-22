import { HttpStatus, Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";

import { getConfig } from "../../core/config";
import { AppError, ErrorCodes } from "../../core/errors";
import { RedisKeyFactory } from "../redis/redis-key.factory";
import { RedisService } from "../redis/redis.service";

const TOKEN_BUCKET_SCRIPT = `
local current = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_per_ms = tonumber(ARGV[3])
local tokens = tonumber(current[1]) or capacity
local updated_at = tonumber(current[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_per_ms)
if tokens < 1 then
  local retry_after_ms = math.ceil((1 - tokens) / refill_per_ms)
  redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_per_ms) * 2)
  return {0, math.floor(tokens), retry_after_ms}
end
tokens = tokens - 1
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_per_ms) * 2)
return {1, math.floor(tokens), 0}
`;

/**
 * Redis 原子令牌桶在所有 API 实例间共享额度。Redis 故障时拒绝公网调用，
 * 避免静默回退到本地内存后绕过限流。
 */
@Injectable()
export class ExternalRateLimiterService {
  private readonly secret = getConfig().rateLimitHashSecret;

  constructor(
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory
  ) {}

  async assertAllowed(scope: string, identifier: string, limitPerMinute: number): Promise<void> {
    const key = this.keys.create("rate-limit", scope, this.hashIdentifier(identifier));
    let result: unknown;
    try {
      result = await this.redis.getClient().eval(
        TOKEN_BUCKET_SCRIPT,
        1,
        key,
        Date.now(),
        limitPerMinute,
        limitPerMinute / 60_000
      );
    } catch {
      throw new AppError(
        ErrorCodes.externalAccess.rateLimitUnavailable,
        "访问保护服务暂不可用，请稍后重试",
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const [allowed] = result as [number, number, number];
    if (allowed !== 1) {
      throw new AppError(
        ErrorCodes.externalAccess.rateLimited,
        "请求过于频繁，请稍后再试",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

  }

  private hashIdentifier(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex").slice(0, 32);
  }
}
