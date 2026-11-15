import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AgentRunStatus } from "@prisma/client";

import { getConfig } from "../core/config";
import { AgentRunsService } from "../modules/agent_runs/agent-runs.service";
import { WorkflowSchedulesService } from "../modules/workflows/workflow-schedules.service";
import { WorkflowScheduleQueue } from "./workflow-schedule.queue";

export type WorkflowScheduleReconcileResult = {
  archivedCanceled: number;
  lostJobsRescheduled: number;
  terminalRunsReconciled: number;
  staleRunsRequeued: number;
  staleRunsFailed: number;
};

/** 只修复可证明安全的不一致；可能已经执行节点的失联 Run 永远不会被自动重跑。 */
@Injectable()
export class WorkflowScheduleReconciler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowScheduleReconciler.name);
  private readonly config = getConfig().workflowScheduler;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<WorkflowScheduleReconcileResult>;
  private stopping = false;

  constructor(
    private readonly schedules: WorkflowSchedulesService,
    private readonly agentRuns: AgentRunsService,
    private readonly queue: WorkflowScheduleQueue
  ) {}

  onModuleInit(): void {
    if (!this.config.reconcilerEnabled) return;
    void this.reconcileOnce();
    const intervalMs = Math.max(15_000, Math.min(60_000, Math.floor(this.config.staleMs / 2)));
    this.timer = setInterval(() => void this.reconcileOnce(), intervalMs);
    this.timer.unref();
  }

  reconcileOnce(now = new Date()): Promise<WorkflowScheduleReconcileResult> {
    if (this.stopping) return Promise.resolve(this.emptyResult());
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runReconciliation(now).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async runReconciliation(now: Date): Promise<WorkflowScheduleReconcileResult> {
    const result = this.emptyResult();
    const limit = this.config.batchSize;
    const staleBefore = new Date(now.getTime() - this.config.staleMs);

    result.archivedCanceled = await this.schedules.cancelArchivedQueuedScheduleRuns(limit);

    const linked = await this.schedules.listLinkedRunningScheduleRuns(limit);
    const statuses = await this.agentRuns.getRunStatusSnapshots(
      linked.map((run) => run.agentRunId)
    );
    const statusByRunId = new Map(statuses.map((run) => [run.runId, run.status]));
    for (const run of linked) {
      const terminal = this.toScheduleTerminal(statusByRunId.get(run.agentRunId));
      if (!terminal) continue;
      await this.schedules.finishScheduleRun(run.scheduleRunId, terminal.status, terminal.error);
      result.terminalRunsReconciled += 1;
    }

    const staleRuns = await this.schedules.listStaleRunningScheduleRuns(staleBefore, limit);
    for (const run of staleRuns) {
      const action = await this.schedules.reconcileStaleRunningScheduleRun(run);
      if (action === "REQUEUED") result.staleRunsRequeued += 1;
      if (action === "FAILED") {
        result.staleRunsFailed += 1;
        if (run.agentRunId) {
          await this.agentRuns
            .failRun(run.agentRunId, {
              type: "worker_lost",
              message: "Workflow Worker 心跳超时"
            })
            .catch((error: unknown) => {
              this.logger.warn(
                `失联 AgentRun 终态写入失败: run=${run.agentRunId} error=${error instanceof Error ? error.message : "unknown"}`
              );
            });
        }
      }
    }

    const jobs = await this.schedules.listStaleDispatchedScheduleJobs(staleBefore, limit);
    for (const job of jobs) {
      if (await this.queue.hasRunnableJob(job.scheduleRunId)) continue;
      if (await this.schedules.rescheduleLostDispatchedJob(job.jobId)) {
        result.lostJobsRescheduled += 1;
      }
    }

    if (Object.values(result).some((value) => value > 0)) {
      this.logger.log(`Workflow Schedule 对账完成 ${JSON.stringify(result)}`);
    }
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  private toScheduleTerminal(
    status: AgentRunStatus | undefined
  ):
    | {
        status: "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT";
        error?: { type: string; message: string };
      }
    | undefined {
    if (status === AgentRunStatus.COMPLETED) return { status: "COMPLETED" };
    if (status === AgentRunStatus.CANCELED) return { status: "CANCELED" };
    if (status === AgentRunStatus.TIMED_OUT) {
      return {
        status: "TIMED_OUT",
        error: { type: "workflow_timeout", message: "AgentRun 已超时" }
      };
    }
    if (status === AgentRunStatus.FAILED) {
      return {
        status: "FAILED",
        error: { type: "agent_run_failed", message: "AgentRun 已失败" }
      };
    }
    return undefined;
  }

  private emptyResult(): WorkflowScheduleReconcileResult {
    return {
      archivedCanceled: 0,
      lostJobsRescheduled: 0,
      terminalRunsReconciled: 0,
      staleRunsRequeued: 0,
      staleRunsFailed: 0
    };
  }
}
