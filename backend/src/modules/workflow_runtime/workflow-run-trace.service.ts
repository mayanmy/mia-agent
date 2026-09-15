import { Injectable } from "@nestjs/common";
import { AgentRunStepType } from "@prisma/client";

import { AgentRunsService } from "../agent_runs/agent-runs.service";
import type { AgentRunStepContext, TraceJsonValue } from "../agent_runs/dto/agent-run-step.dto";
import type { AgentRunErrorDto, CreateAgentRunDto } from "../agent_runs/dto/agent-run.dto";
import type { WorkflowRuntimeErrorData, WorkflowRuntimeEvent } from "./dto/workflow-run.dto";

export type WorkflowRunTrace = {
  runId: string;
  sequence: number;
  activeSteps: Map<string, AgentRunStepContext>;
  firstTokenRecorded: boolean;
  terminal: boolean;
};

/** 把 Workflow Runtime 事件统一持久化为 Run 和节点 Step，供独立应用与 Agent Tool 共用。 */
@Injectable()
export class WorkflowRunTraceService {
  constructor(private readonly agentRunsService: AgentRunsService) {}

  async start(payload: CreateAgentRunDto): Promise<WorkflowRunTrace> {
    const run = await this.agentRunsService.createRun(payload);
    try {
      await this.agentRunsService.startRun(run.runId);
    } catch (error) {
      await this.agentRunsService.cancelRun(run.runId).catch(() => undefined);
      throw error;
    }
    return {
      runId: run.runId,
      sequence: 1,
      activeSteps: new Map(),
      firstTokenRecorded: false,
      terminal: false
    };
  }

  async record(trace: WorkflowRunTrace, event: WorkflowRuntimeEvent): Promise<void> {
    if (trace.terminal) return;

    if (event.type === "node_started") {
      const nodeId = this.eventText(event, "nodeId");
      const nodeType = this.eventText(event, "nodeType");
      const attempt = this.eventInteger(event, "attempt") ?? 1;
      const step = await this.agentRunsService.startStep({
        runId: trace.runId,
        sequence: trace.sequence,
        type: this.toStepType(nodeType),
        name: this.eventText(event, "name") || nodeId,
        nodeId,
        attempt,
        input: { nodeType, attempt }
      });
      trace.sequence += 1;
      trace.activeSteps.set(nodeId, step);
      return;
    }

    if (event.type === "node_completed") {
      const nodeId = this.eventText(event, "nodeId");
      const step = trace.activeSteps.get(nodeId);
      if (step) {
        await this.agentRunsService.completeStep(step.stepId, {
          nodeType: this.eventText(event, "nodeType"),
          selectedHandle: this.eventText(event, "nextHandle") || null,
          output: this.toTraceJsonValue(event.data.output)
        });
        trace.activeSteps.delete(nodeId);
      }
      return;
    }

    if (event.type === "node_failed") {
      const nodeId = this.eventText(event, "nodeId");
      const step = trace.activeSteps.get(nodeId);
      if (step) {
        await this.agentRunsService.failStep(step.stepId, this.readEventError(event));
        trace.activeSteps.delete(nodeId);
      }
      return;
    }

    if (event.type === "token") {
      if (!trace.firstTokenRecorded) {
        trace.firstTokenRecorded = true;
        await this.agentRunsService.markFirstToken(trace.runId);
      }
      return;
    }

    if (event.type === "workflow_completed") {
      await this.agentRunsService.completeRun(trace.runId, {
        outputPreview: this.stringifyPreview(event.data.output)
      });
      trace.terminal = true;
      return;
    }

    if (event.type === "workflow_failed") {
      await this.agentRunsService.failRun(trace.runId, event.data.error);
      trace.terminal = true;
      return;
    }

    if (event.type === "workflow_canceled") {
      await this.agentRunsService.cancelRun(trace.runId);
      trace.terminal = true;
    }
  }

  async ensureTerminal(trace: WorkflowRunTrace): Promise<void> {
    if (trace.terminal) return;
    await this.agentRunsService.failRun(trace.runId, {
      type: "workflow_terminal_event_missing",
      message: "Workflow 运行结束但未产生终态事件"
    });
    trace.terminal = true;
  }

  async fail(trace: WorkflowRunTrace, error: AgentRunErrorDto): Promise<void> {
    if (trace.terminal) return;
    await this.agentRunsService.failRun(trace.runId, error);
    trace.terminal = true;
  }

  stringifyPreview(value: unknown): string {
    try {
      return JSON.stringify(value) ?? "null";
    } catch {
      return "[无法序列化的 Workflow 数据]";
    }
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
