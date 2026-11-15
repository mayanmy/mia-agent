import { Module } from "@nestjs/common";

import { WorkflowsModule } from "../modules/workflows/workflows.module";
import { WorkflowScheduleDispatcher } from "./workflow-schedule.dispatcher";
import { WorkflowScheduleQueue } from "./workflow-schedule.queue";
import { WorkflowScheduleScheduler } from "./workflow-schedule.scheduler";

@Module({
  imports: [WorkflowsModule],
  providers: [WorkflowScheduleScheduler, WorkflowScheduleDispatcher, WorkflowScheduleQueue]
})
export class WorkflowScheduleJobsModule {}
