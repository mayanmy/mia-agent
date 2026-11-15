import { Injectable, Logger } from "@nestjs/common";
import { WorkflowRunMode } from "@prisma/client";

import { runInWorkspaceContext } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowSchedulesService } from "../workflows/workflow-schedules.service";
import { WorkflowRuntimeEvent } from "./dto/workflow-run.dto";
import { WorkflowRunTrace, WorkflowRunTraceService } from "./workflow-run-trace.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

export type WorkflowScheduledRunResult = {
  acquired: boolean;
  scheduleRunId: string;
  status?: "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT";
  agentRunId?: string;
};

/** 独立 Worker 的业务编排层；队列 Consumer 只负责解析 Job ID 和传递取消信号。 */
@Injectable()
export class WorkflowScheduledRunsService {
  private readonly logger = new Logger(WorkflowScheduledRunsService.name);

  constructor(
    private readonly schedules: WorkflowSchedulesService,
    private readonly runtime: WorkflowRuntimeService,
    private readonly traces: WorkflowRunTraceService
  ) {}

  async execute(
    scheduleRunId: string,
    workerId: string,
    shutdownSignal?: AbortSignal
  ): Promise<WorkflowScheduledRunResult> {
    const run = await this.schedules.claimScheduleRunExecution(scheduleRunId, workerId);
    if (!run) return { acquired: false, scheduleRunId };

    return runInWorkspaceContext(run.workspaceId, undefined, async () => {
      let trace: WorkflowRunTrace | undefined;
      let status: WorkflowScheduledRunResult["status"] = "FAILED";
      let terminalError: { type: string; message: string } | undefined;
      const controller = new AbortController();
      let timedOut = false;
      const onShutdown = () => controller.abort();
      shutdownSignal?.addEventListener("abort", onShutdown, { once: true });
      if (shutdownSignal?.aborted) controller.abort();
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, run.timeoutSeconds * 1_000);

      try {
        trace = await this.traces.prepareScheduled({
          workspaceId: run.workspaceId,
          workflowScheduleRunId: run.scheduleRunId,
          requestId: run.requestId,
          workflowId: run.workflowId,
          workflowVersionId: run.workflowVersionId,
          inputPreview: this.traces.stringifyPreview(run.inputs)
        });
        // 只有 Trace ID 成功回写后才把 AgentRun 切到 RUNNING，失败重试可安全找回 QUEUED Trace。
        await this.schedules.linkScheduleRunAgentRun(run.scheduleRunId, trace.runId);
        await this.traces.startPrepared(trace);
        await this.schedules.assertScheduleRunExecutable(run);

        for await (const event of this.runtime.runWorkflow({
          requestId: run.requestId,
          runId: trace.runId,
          workflowId: run.workflowId,
          workflowVersionId: run.workflowVersionId,
          mode: WorkflowRunMode.PUBLISHED,
          inputs: run.inputs,
          signal: controller.signal,
          timeoutMs: run.timeoutSeconds * 1_000
        })) {
          if (event.type === "workflow_canceled" && timedOut) {
            await this.traces.timeout(trace);
          } else {
            await this.traces.record(trace, event);
          }
          const terminal = this.toTerminal(event, timedOut);
          if (terminal) {
            status = terminal.status;
            terminalError = terminal.error;
          }
        }
        await this.traces.ensureTerminal(trace);
      } catch (error) {
        terminalError = this.toOrchestrationError(error);
        if (trace) {
          await this.traces.fail(trace, terminalError).catch((traceError: unknown) => {
            this.logger.error(
              `定时 Workflow AgentRun 终态写入失败: scheduleRun=${run.scheduleRunId} error=${this.errorMessage(traceError)}`
            );
          });
        }
        status = timedOut ? "TIMED_OUT" : shutdownSignal?.aborted ? "CANCELED" : "FAILED";
      } finally {
        clearTimeout(timer);
        shutdownSignal?.removeEventListener("abort", onShutdown);
        await this.schedules
          .finishScheduleRun(run.scheduleRunId, status ?? "FAILED", terminalError)
          .catch((finishError: unknown) => {
            // Runtime 不重跑有副作用的 Workflow；终态不一致交给 P4 对账任务修复。
            this.logger.error(
              `定时 Workflow ScheduleRun 终态写入失败: scheduleRun=${run.scheduleRunId} error=${this.errorMessage(finishError)}`
            );
          });
      }

      return {
        acquired: true,
        scheduleRunId: run.scheduleRunId,
        status,
        ...(trace ? { agentRunId: trace.runId } : {})
      };
    });
  }

  private toTerminal(
    event: WorkflowRuntimeEvent,
    timedOut: boolean
  ):
    | {
        status: "COMPLETED" | "FAILED" | "CANCELED" | "TIMED_OUT";
        error?: { type: string; message: string };
      }
    | undefined {
    if (event.type === "workflow_completed") return { status: "COMPLETED" };
    if (event.type === "workflow_canceled") {
      return timedOut
        ? { status: "TIMED_OUT", error: { type: "workflow_timeout", message: "Workflow 执行超时" } }
        : { status: "CANCELED" };
    }
    if (event.type === "workflow_failed") {
      return {
        status: event.data.error.type === "workflow_timeout" ? "TIMED_OUT" : "FAILED",
        error: { type: event.data.error.type, message: event.data.error.message }
      };
    }
    return undefined;
  }

  private toOrchestrationError(error: unknown): { type: string; message: string } {
    if (
      error instanceof AppError &&
      error.code === ErrorCodes.workflow.scheduleInteractiveToolUnsupported
    ) {
      return {
        type: "interactive_approval_not_supported",
        message: error.message
      };
    }
    return {
      type: "workflow_schedule_orchestration_failed",
      message: this.errorMessage(error)
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "定时 Workflow 编排失败";
  }
}
