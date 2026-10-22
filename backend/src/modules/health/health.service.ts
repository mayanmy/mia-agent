import { Injectable } from "@nestjs/common";

import { getConfig } from "../../core/config";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

export type HealthResponse = {
  status: string;
  appName: string;
  version: string;
  environment: string;
  database: string;
  redis: string;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const config = getConfig();
    const databaseOk = await this.prisma.checkDatabase();
    const redisAvailable = this.redis.isConfigured() ? await this.redis.ping() : false;
    const redisOk = !config.redis.required || redisAvailable;

    return {
      status: databaseOk && redisOk ? "ok" : "degraded",
      appName: config.appName,
      version: config.appVersion,
      environment: config.environment,
      database: databaseOk ? "ok" : "unavailable",
      redis: this.redis.isConfigured() ? (redisAvailable ? "ok" : "unavailable") : "disabled"
    };
  }
}
