import { Module } from "@nestjs/common";

import { WorkflowsModule } from "../modules/workflows/workflows.module";
import { RedisModule } from "../modules/redis/redis.module";
import { AgentRunsModule } from "../modules/agent_runs/agent-runs.module";
import { WorkflowScheduleDispatcher } from "./workflow-schedule.dispatcher";
import { WorkflowScheduleQueue } from "./workflow-schedule.queue";
import { WorkflowScheduleScheduler } from "./workflow-schedule.scheduler";
import { WorkflowScheduleReconciler } from "./workflow-schedule.reconciler";

@Module({
  imports: [WorkflowsModule, RedisModule, AgentRunsModule],
  providers: [
    WorkflowScheduleScheduler,
    WorkflowScheduleDispatcher,
    WorkflowScheduleQueue,
    WorkflowScheduleReconciler
  ]
})
export class WorkflowScheduleJobsModule {}
