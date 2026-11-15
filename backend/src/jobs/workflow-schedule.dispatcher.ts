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
    // P2 强制 dry-run：只验证最小 Job Data，并保留数据库 PENDING Outbox 给 P3 投递。
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

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
