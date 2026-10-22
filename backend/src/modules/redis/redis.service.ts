import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis, { RedisOptions } from "ioredis";

import { getConfig } from "../../core/config";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly config = getConfig().redis;
  private client?: Redis;

  async onModuleInit(): Promise<void> {
    if (!this.config.url) {
      if (this.config.required) throw new Error("MIA_REDIS_URL is required when Redis is enabled");
      return;
    }
    this.client = this.createClient({ maxRetriesPerRequest: 2 });
    this.client.on("error", (error) => this.logger.error(`Redis connection error: ${error.message}`));
    try {
      await this.withTimeout(this.client.ping());
    } catch (error) {
      if (this.config.required) throw error;
      this.logger.warn("Redis is unavailable; Redis-backed features remain disabled");
    }
  }

  isConfigured(): boolean {
    return Boolean(this.config.url);
  }

  getClient(): Redis {
    if (!this.client) throw new Error("Redis is not configured");
    return this.client;
  }

  /** BullMQ 需要自行管理阻塞连接，不能复用普通命令连接。 */
  createBullConnection(): Redis {
    return this.createClient({ maxRetriesPerRequest: null });
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      return (await this.withTimeout(this.client.ping())) === "PONG";
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => this.client?.disconnect());
  }

  private createClient(overrides: RedisOptions): Redis {
    if (!this.config.url) throw new Error("MIA_REDIS_URL is not configured");
    return new Redis(this.config.url, {
      connectTimeout: this.config.connectTimeoutMs,
      enableReadyCheck: true,
      lazyConnect: false,
      ...overrides
    });
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Redis command timeout")), this.config.commandTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
