import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { getConfig } from "../core/config";
import { WorkflowSchedulesService } from "../modules/workflows/workflow-schedules.service";

export type WorkflowScheduleTickResult = {
  candidates: number;
  createdRuns: number;
  duplicateRuns: number;
  skippedOccurrences: number;
  failedSchedules: number;
  elapsedMs: number;
};

@Injectable()
export class WorkflowScheduleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduleScheduler.name);
  private readonly config = getConfig().workflowScheduler;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<WorkflowScheduleTickResult>;
  private stopping = false;

  constructor(private readonly schedules: WorkflowSchedulesService) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.config.pollMs);
    this.timer.unref();
  }

  /** 重叠唤醒复用当前 Promise，避免单实例自身并发扫描。 */
  tick(now = new Date()): Promise<WorkflowScheduleTickResult> {
    if (this.stopping) return Promise.resolve(this.emptyResult());
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runTick(now).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runTick(now: Date): Promise<WorkflowScheduleTickResult> {
    const startedAt = Date.now();
    const claims = await this.schedules.claimDueSchedules(now, this.config.batchSize);
    let createdRuns = 0;
    let duplicateRuns = 0;
    let skippedOccurrences = 0;
    let failedSchedules = 0;

    for (const claim of claims) {
      try {
        const result = await this.schedules.materializeDueRuns(claim.scheduleId, now);
        createdRuns += result.createdRunCount;
        duplicateRuns += result.duplicateRunCount;
        skippedOccurrences += result.skippedCount;
      } catch (error) {
        failedSchedules += 1;
        this.logger.error(
          `Workflow Schedule 物化失败: schedule=${claim.scheduleId} error=${error instanceof Error ? error.message : "unknown"}`
        );
      }
    }
    const result = {
      candidates: claims.length,
      createdRuns,
      duplicateRuns,
      skippedOccurrences,
      failedSchedules,
      elapsedMs: Date.now() - startedAt
    };
    if (claims.length > 0) this.logger.log(`Workflow Schedule 扫描完成 ${JSON.stringify(result)}`);
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  private emptyResult(): WorkflowScheduleTickResult {
    return {
      candidates: 0,
      createdRuns: 0,
      duplicateRuns: 0,
      skippedOccurrences: 0,
      failedSchedules: 0,
      elapsedMs: 0
    };
  }
}
