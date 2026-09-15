import { Injectable } from "@nestjs/common";
import { AgentRunSource, WorkflowRunMode } from "@prisma/client";

import { WorkflowsService } from "../workflows/workflows.service";
import type { WorkflowAppRunResult, WorkflowRuntimeEvent } from "./dto/workflow-run.dto";
import { WorkflowRunTraceService } from "./workflow-run-trace.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

type RunWorkflowAppRequest = {
  requestId: string;
  workflowId: string;
  workflowVersionId?: string;
  userId: string;
  inputs: Record<string, unknown>;
};

/** 编排独立 Workflow 应用执行，并把 Runtime 事件同步持久化为统一 Run Trace。 */
@Injectable()
export class WorkflowAppRunsService {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly traceService: WorkflowRunTraceService
  ) {}

  async runWorkflowApp(request: RunWorkflowAppRequest): Promise<WorkflowAppRunResult> {
    const app = await this.workflowsService.getPublishedApp(request.workflowId);
    if (request.workflowVersionId && request.workflowVersionId !== app.workflowVersionId) {
      return {
        requestId: request.requestId,
        workflowId: request.workflowId,
        workflowVersionId: app.workflowVersionId,
        ok: false,
        error: {
          type: "workflow_version_changed",
          message: "Workflow 已发布新版本，请刷新运行表单",
          retryable: true
        },
        events: []
      };
    }

    const trace = await this.traceService.start({
      requestId: request.requestId,
      source: AgentRunSource.WORKFLOW_APP,
      userId: request.userId,
      workflowId: request.workflowId,
      workflowVersionId: app.workflowVersionId,
      workflowRunMode: WorkflowRunMode.PUBLISHED,
      inputPreview: this.traceService.stringifyPreview(request.inputs)
    });

    try {
      const events: WorkflowRuntimeEvent[] = [];

      for await (const event of this.workflowRuntimeService.runWorkflow({
        requestId: request.requestId,
        runId: trace.runId,
        userId: request.userId,
        workflowId: request.workflowId,
        workflowVersionId: app.workflowVersionId,
        mode: WorkflowRunMode.PUBLISHED,
        inputs: request.inputs
      })) {
        events.push(event);
        await this.traceService.record(trace, event);
      }

      await this.traceService.ensureTerminal(trace);

      return this.toResult(request.requestId, request.workflowId, app.workflowVersionId, events);
    } catch (error) {
      await this.traceService
        .fail(trace, {
          type: "workflow_trace_persistence_failed",
          message: error instanceof Error ? error.message : "Workflow 运行记录写入失败"
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private toResult(
    requestId: string,
    workflowId: string,
    workflowVersionId: string,
    events: WorkflowRuntimeEvent[]
  ): WorkflowAppRunResult {
    const completed = [...events].reverse().find((event) => event.type === "workflow_completed");
    const failed = [...events].reverse().find((event) => event.type === "workflow_failed");
    const output = completed?.type === "workflow_completed" ? completed.data.output : undefined;
    return {
      requestId,
      workflowId,
      workflowVersionId,
      ok: Boolean(completed),
      ...(output && typeof output === "object" && !Array.isArray(output)
        ? { output: output as Record<string, unknown> }
        : {}),
      ...(failed?.type === "workflow_failed" ? { error: failed.data.error } : {}),
      events
    };
  }
}
