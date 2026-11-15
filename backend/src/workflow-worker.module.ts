import { Module } from "@nestjs/common";

import { WorkflowScheduleConsumer } from "./jobs/workflow-schedule.consumer";
import { AgentRunsModule } from "./modules/agent_runs/agent-runs.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RedisModule } from "./modules/redis/redis.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { WorkflowRuntimeModule } from "./modules/workflow_runtime/workflow-runtime.module";

/** Worker 使用 ApplicationContext 启动，不注册 HTTP Server 与全局认证 Guard。 */
@Module({
  imports: [PrismaModule, RedisModule, AgentRunsModule, WorkflowsModule, WorkflowRuntimeModule],
  providers: [WorkflowScheduleConsumer]
})
export class WorkflowWorkerModule {}
