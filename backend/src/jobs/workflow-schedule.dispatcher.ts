import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { getConfig } from "../core/config";
import { WorkflowSchedulesService } from "../modules/workflows/workflow-schedules.service";
import { WorkflowScheduleQueue } from "./workflow-schedule.queue";

export type WorkflowScheduleDispatchResult = {
  pendingJobs: number;
  dryRunJobs: number;
  dispatchedJobs: number;
};

@Injectable()
export class WorkflowScheduleDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduleDispatcher.name);
  private readonly config = getConfig().workflowScheduler;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<WorkflowScheduleDispatchResult>;
  private stopping = false;

  constructor(
    private readonly schedules: WorkflowSchedulesService,
    private readonly queue: WorkflowScheduleQueue
  ) {}

  onModuleInit(): void {
    if (!this.config.dispatcherEnabled) return;
    void this.dispatchOnce();
    this.timer = setInterval(() => void this.dispatchOnce(), this.config.dispatchPollMs);
    this.timer.unref();
  }

  dispatchOnce(now = new Date()): Promise<WorkflowScheduleDispatchResult> {
    if (this.stopping) return Promise.resolve({ pendingJobs: 0, dryRunJobs: 0, dispatchedJobs: 0 });
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runDispatch(now).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runDispatch(now: Date): Promise<WorkflowScheduleDispatchResult> {
    const jobs = await this.schedules.claimPendingScheduleJobs(now, this.config.batchSize);
    if (this.config.dispatcherDryRun) {
      const prepared = jobs.map((job) => this.queue.prepare(job));
      if (prepared.length > 0) {
        this.logger.log(`Workflow Schedule Dispatcher dry-run: jobs=${prepared.length}`);
      }
      return {
        pendingJobs: jobs.length,
        dryRunJobs: prepared.length,
        dispatchedJobs: 0
      };
    }
    let dispatchedJobs = 0;
    for (const job of jobs) {
      try {
        await this.queue.enqueue(job);
        await this.schedules.markScheduleJobDispatched(job.jobId);
        dispatchedJobs += 1;
      } catch (error) {
        const errorCode = error instanceof Error ? error.name : "QUEUE_ERROR";
        if (job.dispatchAttempts + 1 >= 10) {
          await this.schedules.markScheduleJobDead(job.jobId, errorCode);
        } else {
          const delayMs = Math.min(30_000, 1_000 * 2 ** job.dispatchAttempts);
          await this.schedules.rescheduleScheduleJob(
            job.jobId,
            errorCode,
            new Date(Date.now() + delayMs)
          );
        }
      }
    }
    return {
      pendingJobs: jobs.length,
      dryRunJobs: 0,
      dispatchedJobs
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
