import { Injectable, Logger } from "@nestjs/common";

import { getConfig } from "../../core/config";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { WorkflowScheduleHealthSummary } from "../workflows/dto/workflow-schedule.dto";
import { WorkflowSchedulesService } from "../workflows/workflow-schedules.service";

export type HealthResponse = {
  status: string;
  appName: string;
  version: string;
  environment: string;
  database: string;
  redis: string;
  workflowScheduler: {
    status: "disabled" | "ok" | "degraded" | "unavailable";
    schedulerEnabled: boolean;
    dispatcherEnabled: boolean;
    consumerEnabled: boolean;
    summary: WorkflowScheduleHealthSummary | null;
  };
};

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly workflowSchedules: WorkflowSchedulesService
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const config = getConfig();
    const databaseOk = await this.prisma.checkDatabase();
    const redisAvailable = this.redis.isConfigured() ? await this.redis.ping() : false;
    const redisOk = !config.redis.required || redisAvailable;
    let workflowSummary: WorkflowScheduleHealthSummary | null = null;
    let workflowUnavailable = false;
    if (databaseOk && config.workflowScheduler.enabled) {
      try {
        workflowSummary = await this.workflowSchedules.getOperationalHealthSummary(
          new Date(),
          config.workflowScheduler.staleMs,
          Math.max(config.workflowScheduler.pollMs * 4, 60_000)
        );
      } catch (error) {
        // 健康摘要失败不能让 /health 本身返回 500，否则运维侧无法区分 API 与调度子系统故障。
        workflowUnavailable = true;
        this.logger.error(
          `Workflow Scheduler 健康摘要失败: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    const workflowStatus = !config.workflowScheduler.enabled
      ? "disabled"
      : !databaseOk || workflowUnavailable
        ? "unavailable"
        : workflowSummary &&
            (workflowSummary.overdueSchedules > 0 || workflowSummary.staleRunningRuns > 0)
          ? "degraded"
          : "ok";

    return {
      status:
        databaseOk && redisOk && (workflowStatus === "ok" || workflowStatus === "disabled")
          ? "ok"
          : "degraded",
      appName: config.appName,
      version: config.appVersion,
      environment: config.environment,
      database: databaseOk ? "ok" : "unavailable",
      redis: this.redis.isConfigured() ? (redisAvailable ? "ok" : "unavailable") : "disabled",
      workflowScheduler: {
        status: workflowStatus,
        schedulerEnabled: config.workflowScheduler.enabled,
        dispatcherEnabled: config.workflowScheduler.dispatcherEnabled,
        consumerEnabled: config.workflowScheduler.consumerEnabled,
        summary: workflowSummary
      }
    };
  }
}
