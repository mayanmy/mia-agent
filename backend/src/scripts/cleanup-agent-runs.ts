import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module";
import { AgentRunsService } from "../modules/agent_runs/agent-runs.service";

/** 从环境变量读取保留天数；业务校验仍由 AgentRunsService 统一执行。 */
function readRetentionDays(name: string, fallback: number): number {
  const value = process.env[name];
  return value ? Number(value) : fallback;
}

/** 创建无 HTTP Listener 的应用上下文，执行一次清理并可靠释放数据库连接。 */
async function cleanupAgentRuns(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });

  try {
    const result = await app
      .get(AgentRunsService)
      .cleanupExpiredRuns(
        readRetentionDays("AGENT_RUN_COMPLETED_RETENTION_DAYS", 90),
        readRetentionDays("AGENT_RUN_FAILED_RETENTION_DAYS", 180)
      );
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

void cleanupAgentRuns().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
