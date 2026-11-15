import { NestFactory } from "@nestjs/core";
import { Module } from "@nestjs/common";

import { WorkflowSchedulesService } from "../modules/workflows/workflow-schedules.service";
import { PrismaModule } from "../modules/prisma/prisma.module";
import { RedisModule } from "../modules/redis/redis.module";
import { WorkflowsModule } from "../modules/workflows/workflows.module";

/** 清理上下文不加载 Scheduler/Dispatcher/Worker，避免维护命令意外启动后台循环。 */
@Module({ imports: [PrismaModule, RedisModule, WorkflowsModule] })
class WorkflowScheduleCleanupModule {}

function readRetentionDays(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

/** 运行一次终态历史清理；任务记录由 workflows 模块统一删除，避免脚本绕过数据归属边界。 */
async function cleanupWorkflowScheduleRuns(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkflowScheduleCleanupModule, {
    logger: ["error", "warn"]
  });
  try {
    const result = await app
      .get(WorkflowSchedulesService)
      .cleanupExpiredRuns(
        readRetentionDays("WORKFLOW_SCHEDULE_COMPLETED_RETENTION_DAYS", 90),
        readRetentionDays("WORKFLOW_SCHEDULE_FAILED_RETENTION_DAYS", 180)
      );
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

void cleanupWorkflowScheduleRuns().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
