import { Injectable } from "@nestjs/common";

import { WorkflowScheduleJobDispatchDto } from "../modules/workflows/dto/workflow-schedule.dto";

export const WORKFLOW_SCHEDULE_QUEUE_NAME = "workflow-scheduled-runs";
export const WORKFLOW_SCHEDULE_JOB_NAME = "execute-scheduled-run";

export type WorkflowScheduleQueueJob = {
  name: typeof WORKFLOW_SCHEDULE_JOB_NAME;
  jobId: string;
  data: { scheduleRunId: string };
};

/**
 * P2 只形成可审计的投递载荷，不连接 BullMQ。P3 Consumer 就绪后再由本边界增加真实 add，
 * 保证现在即使误开 Dispatcher 也不会执行 Workflow。
 */
@Injectable()
export class WorkflowScheduleQueue {
  prepare(job: WorkflowScheduleJobDispatchDto): WorkflowScheduleQueueJob {
    return {
      name: WORKFLOW_SCHEDULE_JOB_NAME,
      jobId: job.scheduleRunId,
      data: { scheduleRunId: job.scheduleRunId }
    };
  }
}
