import { Injectable } from "@nestjs/common";
import { WorkflowRunMode } from "@prisma/client";

import { CompiledWorkflowNode, CompiledWorkflowPlan } from "../workflows/dto/compiled-plan.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import {
  NodeExecutionEvent,
  NodeExecutionResult,
  WorkflowNodeExecutor
} from "./dto/node-execution.dto";
import {
  WorkflowRunRequest,
  WorkflowRuntimeErrorData,
  WorkflowRuntimeEvent
} from "./dto/workflow-run.dto";
import { WorkflowNodeExecutorRegistry } from "./node-executor.registry";
import { createWorkflowContext, WorkflowContext } from "./workflow-context";
import { WorkflowRuntimeError } from "./workflow-runtime.error";

const MAX_PLAN_NODES = 50;
const MAX_PLAN_EDGES = 100;
const MAX_EXECUTED_NODES = 50;
const DEFAULT_WORKFLOW_TIMEOUT_MS = 180_000;
const MAX_WORKFLOW_TIMEOUT_MS = 300_000;
const DEFAULT_NODE_TIMEOUT_MS = 30_000;
const DEFAULT_LLM_NODE_TIMEOUT_MS = 120_000;
const MAX_NODE_TIMEOUT_MS = 120_000;
const MAX_NODE_OUTPUT_BYTES = 1024 * 1024;
const MAX_CONTEXT_BYTES = 5 * 1024 * 1024;
const EVENT_PREVIEW_BYTES = 10 * 1024;

@Injectable()
export class WorkflowRuntimeService {
  /** Runtime 只读取已发布版本，并通过注册表调用无数据库依赖的节点执行器。 */
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly executorRegistry: WorkflowNodeExecutorRegistry
  ) {}

  /**
   * 顺序执行不可变 Compiled Plan 并产生协议无关事件。W3 仅运行已发布版本，
   * 草稿测试将在测试运行 API 接入时传入临时编译计划。
   */
  async *runWorkflow(request: WorkflowRunRequest): AsyncIterable<WorkflowRuntimeEvent> {
    let currentNodeId: string | undefined;
    try {
      this.throwIfAborted(request.signal);
      if (request.mode !== WorkflowRunMode.PUBLISHED) {
        throw new WorkflowRuntimeError(
          "workflow_run_mode_unsupported",
          "W3 Runtime 仅支持已发布 Workflow Version"
        );
      }
      const version = await this.workflowsService.getPublishedRuntimeConfig(
        request.workflowId,
        request.workflowVersionId
      );
      const plan = this.parsePlan(version.compiledPlan);
      this.validatePlanLimits(plan);
      const timeoutMs = this.normalizeWorkflowTimeout(request.timeoutMs);
      const deadline = Date.now() + timeoutMs;
      const context = createWorkflowContext(request);
      this.assertContextSize(context);

      yield {
        type: "workflow_started",
        data: {
          requestId: request.requestId,
          runId: request.runId,
          agentId: request.agentId,
          workflowId: request.workflowId,
          workflowVersionId: request.workflowVersionId,
          mode: request.mode,
          checksum: version.checksum
        }
      };

      currentNodeId = plan.startNodeId;
      let executedNodes = 0;
      while (currentNodeId) {
        this.throwIfAborted(request.signal, currentNodeId);
        if (Date.now() >= deadline) throw this.workflowTimeout(currentNodeId);
        executedNodes += 1;
        if (executedNodes > MAX_EXECUTED_NODES) {
          throw new WorkflowRuntimeError(
            "workflow_execution_limit_exceeded",
            `Workflow 实际执行节点不能超过 ${MAX_EXECUTED_NODES}`,
            currentNodeId
          );
        }

        const node = plan.nodes[currentNodeId];
        if (!node) {
          throw new WorkflowRuntimeError(
            "workflow_plan_invalid",
            `Compiled Plan 缺少节点: ${currentNodeId}`,
            currentNodeId
          );
        }
        yield {
          type: "node_started",
          data: { nodeId: node.id, nodeType: node.type, name: node.name, attempt: 1 }
        };

        let result: NodeExecutionResult;
        try {
          const executor = this.executorRegistry.get(node.type, node.id);
          const execution = this.executeNode(executor, node, context, request.signal, deadline);
          while (true) {
            const next = await execution.next();
            if (next.done) {
              result = next.value;
              break;
            }
            if (next.value.type === "token") {
              yield { type: "token", data: { content: next.value.data.content } };
            }
          }
          if (result.status !== "completed") {
            throw new WorkflowRuntimeError(
              "workflow_node_failed",
              `节点返回非完成状态: ${result.status}`,
              node.id
            );
          }
          this.assertNodeOutput(result.output, node.id);
          context.nodes[node.id] = { output: result.output };
          this.assertContextSize(context, node.id);
        } catch (error) {
          const runtimeError = this.normalizeError(error, node.id);
          if (request.signal?.aborted) throw runtimeError;
          yield {
            type: "node_failed",
            data: { nodeId: node.id, nodeType: node.type, error: this.toErrorData(runtimeError) }
          };
          throw runtimeError;
        }

        yield {
          type: "node_completed",
          data: {
            nodeId: node.id,
            nodeType: node.type,
            nextHandle: result.nextHandle,
            output: this.toEventPreview(result.output)
          }
        };
        if (node.type === "end") {
          yield {
            type: "workflow_completed",
            data: {
              requestId: request.requestId,
              runId: request.runId,
              workflowId: request.workflowId,
              workflowVersionId: request.workflowVersionId,
              executedNodes,
              output: result.output,
              answer: typeof result.output.answer === "string" ? result.output.answer : undefined
            }
          };
          return;
        }
        currentNodeId = this.selectNextNode(plan, node, result.nextHandle);
      }
      throw new WorkflowRuntimeError("workflow_plan_invalid", "Workflow 未到达 End 节点");
    } catch (error) {
      const runtimeError = this.normalizeError(error, currentNodeId);
      if (request.signal?.aborted || runtimeError.type === "workflow_canceled") {
        yield {
          type: "workflow_canceled",
          data: { requestId: request.requestId, runId: request.runId, nodeId: currentNodeId }
        };
        return;
      }
      yield { type: "workflow_failed", data: { error: this.toErrorData(runtimeError) } };
    }
  }

  /** 节点执行使用组合 AbortSignal；超时会先通知 Executor 取消上游操作，再返回分类错误。 */
  private async *executeNode(
    executor: WorkflowNodeExecutor,
    node: CompiledWorkflowNode,
    context: WorkflowContext,
    requestSignal: AbortSignal | undefined,
    deadline: number
  ): AsyncGenerator<NodeExecutionEvent, NodeExecutionResult, void> {
    const configuredTimeout = this.normalizeNodeTimeout(node.config.timeoutSeconds, node.type);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw this.workflowTimeout(node.id);
    const timeoutMs = Math.min(configuredTimeout, remaining);
    const timeoutType =
      remaining <= configuredTimeout ? "workflow_timeout" : "workflow_node_timeout";
    const controller = new AbortController();

    let rejectAbort: ((reason: WorkflowRuntimeError) => void) | undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = (): void => {
      controller.abort();
      rejectAbort?.(this.canceled(node.id));
    };
    const timer = setTimeout(() => {
      controller.abort();
      rejectAbort?.(
        new WorkflowRuntimeError(
          timeoutType,
          timeoutType === "workflow_timeout" ? "Workflow 执行超时" : "Workflow 节点执行超时",
          node.id,
          true
        )
      );
    }, timeoutMs);
    requestSignal?.addEventListener("abort", onAbort, { once: true });

    try {
      if (requestSignal?.aborted) {
        controller.abort();
        throw this.canceled(node.id);
      }
      const execution = executor.execute({ node, context, signal: controller.signal });
      if (!this.isAsyncIterable(execution)) {
        return await Promise.race([execution, interrupted]);
      }

      const iterator = execution[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), interrupted]);
        if (next.done) {
          throw new WorkflowRuntimeError(
            "workflow_output_invalid",
            "流式节点结束前必须产生 result 事件",
            node.id
          );
        }
        if (next.value.type === "result") return next.value.data;
        yield next.value;
      }
    } finally {
      clearTimeout(timer);
      requestSignal?.removeEventListener("abort", onAbort);
    }
  }

  /** Condition 按返回 Handle 选择边，普通节点只能沿唯一默认边继续。 */
  private selectNextNode(
    plan: CompiledWorkflowPlan,
    node: CompiledWorkflowNode,
    nextHandle?: string
  ): string {
    const edges = plan.outgoingEdges[node.id] ?? [];
    const edge =
      node.type === "condition"
        ? edges.find((candidate) => candidate.sourceHandle === nextHandle)
        : edges[0];
    if (!edge) {
      throw new WorkflowRuntimeError(
        "workflow_plan_invalid",
        node.type === "condition"
          ? `Condition 未找到 Handle 对应出边: ${nextHandle ?? "<empty>"}`
          : "节点缺少后续出边",
        node.id
      );
    }
    return edge.target;
  }

  /** 读取数据库 JSON 前验证 Runtime 必需字段，历史坏版本不能造成无分类 TypeError。 */
  private parsePlan(value: Record<string, unknown>): CompiledWorkflowPlan {
    if (
      value.schemaVersion !== 1 ||
      typeof value.startNodeId !== "string" ||
      !Array.isArray(value.topologicalOrder) ||
      !this.isRecord(value.nodes) ||
      !this.isRecord(value.outgoingEdges) ||
      !Array.isArray(value.requiredInputs) ||
      !this.isRecord(value.resourceFingerprints)
    ) {
      throw new WorkflowRuntimeError("workflow_plan_invalid", "Compiled Plan 格式无效");
    }
    const plan = value as unknown as CompiledWorkflowPlan;
    if (
      !plan.nodes[plan.startNodeId] ||
      !plan.topologicalOrder.every((id) => typeof id === "string" && Boolean(plan.nodes[id])) ||
      !Object.values(plan.nodes).every((node) => this.isCompiledNode(node)) ||
      !Object.values(plan.outgoingEdges).every(
        (edges) =>
          Array.isArray(edges) &&
          edges.every(
            (edge) =>
              this.isRecord(edge) &&
              typeof edge.id === "string" &&
              typeof edge.target === "string" &&
              Boolean(plan.nodes[edge.target])
          )
      )
    ) {
      throw new WorkflowRuntimeError("workflow_plan_invalid", "Compiled Plan 节点或边格式无效");
    }
    return plan;
  }

  /** Runtime 使用比草稿更严格的执行上限，阻止历史或手工数据放大单次请求成本。 */
  private validatePlanLimits(plan: CompiledWorkflowPlan): void {
    const nodeCount = Object.keys(plan.nodes).length;
    const edgeCount = Object.values(plan.outgoingEdges).reduce(
      (total, edges) => total + edges.length,
      0
    );
    if (nodeCount > MAX_PLAN_NODES || edgeCount > MAX_PLAN_EDGES) {
      throw new WorkflowRuntimeError(
        "workflow_execution_limit_exceeded",
        `Workflow 运行计划不能超过 ${MAX_PLAN_NODES} 个节点和 ${MAX_PLAN_EDGES} 条边`
      );
    }
  }

  /** 单节点输出先检查可序列化性和 1 MB 上限，再写入 Context。 */
  private assertNodeOutput(output: Record<string, unknown>, nodeId: string): void {
    if (!this.isRecord(output)) {
      throw new WorkflowRuntimeError("workflow_output_invalid", "节点输出必须是对象", nodeId);
    }
    const bytes = this.jsonBytes(output, "节点输出无法 JSON 序列化", nodeId);
    if (bytes > MAX_NODE_OUTPUT_BYTES) {
      throw new WorkflowRuntimeError(
        "workflow_context_too_large",
        `节点输出不能超过 ${MAX_NODE_OUTPUT_BYTES} 字节`,
        nodeId
      );
    }
  }

  /** Context 每次写节点结果后重新计量，5 MB 上限覆盖输入与累计输出。 */
  private assertContextSize(context: WorkflowContext, nodeId?: string): void {
    const bytes = this.jsonBytes(context, "Workflow Context 无法 JSON 序列化", nodeId);
    if (bytes > MAX_CONTEXT_BYTES) {
      throw new WorkflowRuntimeError(
        "workflow_context_too_large",
        `Workflow Context 不能超过 ${MAX_CONTEXT_BYTES} 字节`,
        nodeId
      );
    }
  }

  /** Event 只携带最多 10 KB 的节点预览，完整结果仍保留在受限 Context 中。 */
  private toEventPreview(output: Record<string, unknown>): unknown {
    const serialized = JSON.stringify(output);
    return Buffer.byteLength(serialized, "utf8") <= EVENT_PREVIEW_BYTES
      ? output
      : { truncated: true, preview: serialized.slice(0, EVENT_PREVIEW_BYTES) };
  }

  /** JSON 字节计算统一捕获循环引用和 BigInt 等不可序列化值。 */
  private jsonBytes(value: unknown, message: string, nodeId?: string): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      throw new WorkflowRuntimeError("workflow_output_invalid", message, nodeId);
    }
  }

  /** 总超时允许调用方缩短，但不能扩大到系统安全上限之外。 */
  private normalizeWorkflowTimeout(value: unknown): number {
    if (value === undefined) return DEFAULT_WORKFLOW_TIMEOUT_MS;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_WORKFLOW_TIMEOUT_MS) {
      throw new WorkflowRuntimeError(
        "workflow_timeout_invalid",
        `Workflow timeoutMs 必须在 1-${MAX_WORKFLOW_TIMEOUT_MS} 之间`
      );
    }
    return Number(value);
  }

  /** 节点 timeoutSeconds 受系统上限约束，避免配置绕过总运行治理。 */
  private normalizeNodeTimeout(value: unknown, nodeType: string): number {
    if (value === undefined) {
      return nodeType === "llm" ? DEFAULT_LLM_NODE_TIMEOUT_MS : DEFAULT_NODE_TIMEOUT_MS;
    }
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) && milliseconds >= 1
      ? Math.min(milliseconds, MAX_NODE_TIMEOUT_MS)
      : DEFAULT_NODE_TIMEOUT_MS;
  }

  /** 在启动节点前快速响应用户取消，避免产生多余执行事件。 */
  private throwIfAborted(signal?: AbortSignal, nodeId?: string): void {
    if (signal?.aborted) throw this.canceled(nodeId);
  }

  /** 未知异常转成稳定分类，不对外泄露堆栈或底层对象。 */
  private normalizeError(error: unknown, nodeId?: string): WorkflowRuntimeError {
    if (error instanceof WorkflowRuntimeError) return error;
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return this.canceled(nodeId);
    }
    return new WorkflowRuntimeError(
      "workflow_node_failed",
      error instanceof Error && error.message ? error.message : "Workflow 节点执行失败",
      nodeId
    );
  }

  /** Runtime Event 只暴露安全错误字段和可重试标记。 */
  private toErrorData(error: WorkflowRuntimeError): WorkflowRuntimeErrorData {
    return {
      type: error.type,
      message: error.message,
      nodeId: error.nodeId,
      retryable: error.retryable
    };
  }

  /** 构造统一取消错误，最终由顶层映射为 workflow_canceled。 */
  private canceled(nodeId?: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_canceled", "Workflow 已取消", nodeId);
  }

  /** 总超时与节点超时分开分类，便于后续 Run Trace 统计。 */
  private workflowTimeout(nodeId?: string): WorkflowRuntimeError {
    return new WorkflowRuntimeError("workflow_timeout", "Workflow 执行超时", nodeId, true);
  }

  /** Compiled Plan 和节点输出中的对象均必须是非数组对象。 */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** 节点必须具备稳定 ID、已注册类型所需名称和对象配置。 */
  private isCompiledNode(value: unknown): value is CompiledWorkflowNode {
    return Boolean(
      this.isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.type === "string" &&
      typeof value.name === "string" &&
      this.isRecord(value.config)
    );
  }

  /** 同时支持 W3 普通 Promise 执行器与 W4 LLM 异步事件流执行器。 */
  private isAsyncIterable(
    value: Promise<NodeExecutionResult> | AsyncIterable<NodeExecutionEvent>
  ): value is AsyncIterable<NodeExecutionEvent> {
    return Boolean(
      value &&
      typeof (value as AsyncIterable<NodeExecutionEvent>)[Symbol.asyncIterator] === "function"
    );
  }
}
