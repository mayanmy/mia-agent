import { Injectable, Logger } from "@nestjs/common";
import { AgentRunSource, WorkflowRunMode } from "@prisma/client";
import { randomUUID } from "node:crypto";

import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolJsonValue
} from "../tools/dto/tool.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowRunTrace, WorkflowRunTraceService } from "./workflow-run-trace.service";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

export type WorkflowToolRunRequest = ToolExecutionRequest & {
  /** 子 Workflow Run 继承触发它的 Agent 入口来源。 */
  runSource: AgentRunSource;
};

/** 执行 Agent 绑定的 Workflow Tool，并为每次调用创建可独立回放的 Workflow Run。 */
@Injectable()
export class WorkflowToolRunsService {
  private readonly logger = new Logger(WorkflowToolRunsService.name);

  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly traceService: WorkflowRunTraceService
  ) {}

  async execute(request: WorkflowToolRunRequest): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const binding = this.workflowsService.parseWorkflowToolId(request.toolId);
    if (!binding) {
      return {
        toolId: request.toolId,
        ok: false,
        errorType: "workflow_tool_id_invalid",
        errorMessage: "Workflow Tool ID 无效",
        elapsedMs: Date.now() - startedAt
      };
    }

    const requestId = request.requestId?.trim() || randomUUID();
    let trace: WorkflowRunTrace | undefined;
    try {
      trace = await this.traceService.start({
        requestId,
        source: request.runSource,
        agentId: request.agentId,
        userId: request.userId,
        workflowId: binding.workflowId,
        workflowVersionId: binding.workflowVersionId,
        workflowRunMode: WorkflowRunMode.PUBLISHED,
        inputPreview: this.traceService.stringifyPreview(request.input)
      });
    } catch (error) {
      // Trace 是弱依赖，写库失败不能让已经被模型选择的业务 Workflow 无法执行。
      this.logTraceFailure("创建 Workflow Tool Run 失败", error);
    }

    let output: Record<string, unknown> | undefined;
    let failure: { type: string; message: string } | undefined;
    for await (const event of this.workflowRuntimeService.runWorkflow({
      requestId,
      runId: trace?.runId,
      agentId: request.agentId,
      userId: request.userId,
      workflowId: binding.workflowId,
      workflowVersionId: binding.workflowVersionId,
      mode: WorkflowRunMode.PUBLISHED,
      inputs: request.input,
      signal: request.signal
    })) {
      if (trace) {
        try {
          await this.traceService.record(trace, event);
        } catch (error) {
          this.logTraceFailure(`写入 Workflow Tool Step 失败: ${trace.runId}`, error);
          await this.traceService
            .fail(trace, {
              type: "workflow_trace_persistence_failed",
              message: error instanceof Error ? error.message : "Workflow 运行记录写入失败"
            })
            .catch(() => undefined);
          trace = undefined;
        }
      }

      if (event.type === "workflow_completed") {
        const value = event.data.output;
        output =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : { result: value };
      }
      if (event.type === "workflow_failed") failure = event.data.error;
      if (event.type === "workflow_canceled") {
        failure = {
          type: "workflow_canceled",
          message: "Workflow 执行已中止，未获得业务系统结果"
        };
      }
    }

    if (trace) {
      await this.traceService.ensureTerminal(trace).catch((error) => {
        this.logTraceFailure(`结束 Workflow Tool Run 失败: ${trace?.runId}`, error);
      });
    }

    return output
      ? {
          toolId: request.toolId,
          ok: true,
          output: output as ToolJsonValue,
          elapsedMs: Date.now() - startedAt
        }
      : {
          toolId: request.toolId,
          ok: false,
          errorType: failure?.type ?? "workflow_tool_failed",
          errorMessage: failure?.message ?? "Workflow Tool 执行失败",
          elapsedMs: Date.now() - startedAt
        };
  }

  private logTraceFailure(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
