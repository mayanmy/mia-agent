import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { getConfig } from "../../core/config";
import { AppError, ErrorCodes } from "../../core/errors";
import { RedisKeyFactory } from "../redis/redis-key.factory";
import { RedisService } from "../redis/redis.service";
import { ModelCallPurpose } from "./dto/llm.dto";

const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local member = ARGV[3]
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
  if redis.call('ZCARD', key) >= tonumber(ARGV[3 + i]) then return 0 end
end
for _, key in ipairs(KEYS) do
  redis.call('ZADD', key, expires, member)
  redis.call('PEXPIRE', key, expires - now + 1000)
end
return 1
`;

const RELEASE_SCRIPT = `for _, key in ipairs(KEYS) do redis.call('ZREM', key, ARGV[1]) end return 1`;
const RENEW_SCRIPT = `
for _, key in ipairs(KEYS) do
  if redis.call('ZSCORE', key, ARGV[1]) then
    redis.call('ZADD', key, ARGV[2], ARGV[1])
    redis.call('PEXPIRE', key, tonumber(ARGV[3]))
  else return 0 end
end
return 1
`;

export type ModelCapacityLease = { release(): Promise<void> };

@Injectable()
export class ModelCapacityService {
  private readonly config = getConfig().modelCapacity;

  constructor(
    private readonly redis: RedisService,
    private readonly keys: RedisKeyFactory
  ) {}

  async acquire(
    providerId: string,
    purpose: ModelCallPurpose,
    signal?: AbortSignal
  ): Promise<ModelCapacityLease> {
    if (!this.config.enabled) return { release: async () => undefined };
    const dimensions = this.dimensions(providerId, purpose);
    const permitId = randomUUID();
    const deadline = Date.now() + this.config.acquireTimeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("model capacity acquisition canceled");
      const now = Date.now();
      try {
        const acquired = await this.redis.getClient().eval(
          ACQUIRE_SCRIPT,
          dimensions.length,
          ...dimensions.map((item) => item.key),
          now,
          now + this.config.leaseMs,
          permitId,
          ...dimensions.map((item) => item.limit)
        );
        if (acquired === 1) return this.createLease(dimensions.map((item) => item.key), permitId);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          ErrorCodes.provider.capacityUnavailable,
          "模型容量控制服务暂不可用",
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      await this.waitForRetry(signal);
    }
    throw new AppError(
      ErrorCodes.provider.capacityTimeout,
      "模型调用繁忙，请稍后重试",
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  private dimensions(providerId: string, purpose: ModelCallPurpose) {
    const isEvaluation = purpose === "evaluation_answer" || purpose === "evaluation_grader";
    const purposeLimit = purpose === "embedding"
      ? this.config.embeddingConcurrency
      : isEvaluation
        ? this.config.evaluationConcurrency
        : this.config.onlineConcurrency;
    return [
      { key: this.keys.create("semaphore", "global", "llm"), limit: this.config.globalConcurrency },
      { key: this.keys.create("semaphore", "provider", providerId), limit: this.config.providerConcurrency },
      { key: this.keys.create("semaphore", "purpose", purpose), limit: purposeLimit }
    ];
  }

  private createLease(keys: string[], permitId: string): ModelCapacityLease {
    let released = false;
    const renewEveryMs = Math.max(1_000, Math.floor(this.config.leaseMs / 3));
    const timer = setInterval(() => {
      const expires = Date.now() + this.config.leaseMs;
      void this.redis
        .getClient()
        .eval(RENEW_SCRIPT, keys.length, ...keys, permitId, expires, this.config.leaseMs + 1000)
        .catch(() => undefined);
    }, renewEveryMs);
    timer.unref();
    return {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        await this.redis.getClient().eval(RELEASE_SCRIPT, keys.length, ...keys, permitId).catch(() => undefined);
      }
    };
  }

  private waitForRetry(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 100);
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new Error("model capacity acquisition canceled"));
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
