import { Injectable } from "@nestjs/common";
import { AgentRunSource, AgentRunStepType, WorkflowRunMode } from "@prisma/client";

import { AgentRunsService } from "../agent_runs/agent-runs.service";
import type { AgentRunStepContext, TraceJsonValue } from "../agent_runs/dto/agent-run-step.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import type {
  WorkflowAppRunResult,
  WorkflowRuntimeErrorData,
  WorkflowRuntimeEvent
} from "./dto/workflow-run.dto";
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
    private readonly agentRunsService: AgentRunsService
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

    const run = await this.agentRunsService.createRun({
      requestId: request.requestId,
      source: AgentRunSource.WORKFLOW_APP,
      userId: request.userId,
      workflowId: request.workflowId,
      workflowVersionId: app.workflowVersionId,
      workflowRunMode: WorkflowRunMode.PUBLISHED,
      inputPreview: this.stringifyPreview(request.inputs)
    });
    let runStarted = false;
    let runFinished = false;

    try {
      await this.agentRunsService.startRun(run.runId);
      runStarted = true;
      const events: WorkflowRuntimeEvent[] = [];
      const activeSteps = new Map<string, AgentRunStepContext>();
      let sequence = 1;
      let firstTokenRecorded = false;

      for await (const event of this.workflowRuntimeService.runWorkflow({
        requestId: request.requestId,
        runId: run.runId,
        userId: request.userId,
        workflowId: request.workflowId,
        workflowVersionId: app.workflowVersionId,
        mode: WorkflowRunMode.PUBLISHED,
        inputs: request.inputs
      })) {
        events.push(event);

        if (event.type === "node_started") {
          const nodeId = this.eventText(event, "nodeId");
          const nodeType = this.eventText(event, "nodeType");
          const step = await this.agentRunsService.startStep({
            runId: run.runId,
            sequence,
            type: this.toStepType(nodeType),
            name: this.eventText(event, "name") || nodeId,
            nodeId,
            attempt: this.eventInteger(event, "attempt") ?? 1,
            input: { nodeType, attempt: this.eventInteger(event, "attempt") ?? 1 }
          });
          sequence += 1;
          activeSteps.set(nodeId, step);
          continue;
        }

        if (event.type === "node_completed") {
          const nodeId = this.eventText(event, "nodeId");
          const step = activeSteps.get(nodeId);
          if (step) {
            await this.agentRunsService.completeStep(step.stepId, {
              nodeType: this.eventText(event, "nodeType"),
              selectedHandle: this.eventText(event, "nextHandle") || null,
              output: this.toTraceJsonValue(event.data.output)
            });
            activeSteps.delete(nodeId);
          }
          continue;
        }

        if (event.type === "node_failed") {
          const nodeId = this.eventText(event, "nodeId");
          const step = activeSteps.get(nodeId);
          if (step) {
            await this.agentRunsService.failStep(step.stepId, this.readEventError(event));
            activeSteps.delete(nodeId);
          }
          continue;
        }

        if (event.type === "token") {
          // 流式节点可能产生大量 token，只在首次 token 到达时写一次数据库。
          if (!firstTokenRecorded) {
            firstTokenRecorded = true;
            await this.agentRunsService.markFirstToken(run.runId);
          }
          continue;
        }

        if (event.type === "workflow_completed") {
          await this.agentRunsService.completeRun(run.runId, {
            outputPreview: this.stringifyPreview(event.data.output)
          });
          runFinished = true;
          continue;
        }

        if (event.type === "workflow_failed") {
          await this.agentRunsService.failRun(run.runId, event.data.error);
          runFinished = true;
          continue;
        }

        if (event.type === "workflow_canceled") {
          await this.agentRunsService.cancelRun(run.runId);
          runFinished = true;
        }
      }

      if (!runFinished) {
        await this.agentRunsService.failRun(run.runId, {
          type: "workflow_terminal_event_missing",
          message: "Workflow 运行结束但未产生终态事件"
        });
      }

      return this.toResult(request.requestId, request.workflowId, app.workflowVersionId, events);
    } catch (error) {
      if (!runFinished) {
        const normalized = this.normalizeError(error);
        if (runStarted) {
          await this.agentRunsService.failRun(run.runId, normalized).catch(() => undefined);
        } else {
          await this.agentRunsService.cancelRun(run.runId).catch(() => undefined);
        }
      }
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

  private toStepType(nodeType: string): AgentRunStepType {
    if (nodeType === "llm") return AgentRunStepType.MODEL;
    if (nodeType === "retrieval") return AgentRunStepType.RETRIEVAL;
    if (nodeType === "tool") return AgentRunStepType.TOOL;
    if (nodeType === "condition") return AgentRunStepType.CONDITION;
    if (nodeType === "template") return AgentRunStepType.TRANSFORM;
    return AgentRunStepType.WORKFLOW;
  }

  private eventText(event: WorkflowRuntimeEvent, key: string): string {
    const value = (event.data as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }

  private eventInteger(event: WorkflowRuntimeEvent, key: string): number | undefined {
    const value = (event.data as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  }

  private readEventError(event: WorkflowRuntimeEvent): WorkflowRuntimeErrorData {
    const value = (event.data as Record<string, unknown>).error;
    if (value && typeof value === "object") {
      const error = value as Record<string, unknown>;
      return {
        type: typeof error.type === "string" ? error.type : "workflow_node_failed",
        message: typeof error.message === "string" ? error.message : "Workflow 节点执行失败",
        retryable: error.retryable === true
      };
    }
    return { type: "workflow_node_failed", message: "Workflow 节点执行失败", retryable: false };
  }

  private normalizeError(error: unknown): WorkflowRuntimeErrorData {
    return {
      type: "workflow_trace_persistence_failed",
      message: error instanceof Error ? error.message : "Workflow 运行记录写入失败",
      retryable: false
    };
  }

  private stringifyPreview(value: unknown): string {
    try {
      return JSON.stringify(value) ?? "null";
    } catch {
      return "[无法序列化的 Workflow 数据]";
    }
  }

  private toTraceJsonValue(value: unknown): TraceJsonValue {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((item) => this.toTraceJsonValue(item));
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.toTraceJsonValue(item)])
      );
    }
    return null;
  }
}
