import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  AgentExecutionMode,
  AgentRunSource,
  AgentRunStepType,
  ModelCapabilityType,
  WorkflowRunMode
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AgentRunsService } from "../agent_runs/agent-runs.service";
import { AgentRunErrorDto } from "../agent_runs/dto/agent-run.dto";
import { TraceJsonValue } from "../agent_runs/dto/agent-run-step.dto";
import { RuntimeError } from "./dto/runtime-error.dto";
import { AgentsService } from "../agents/agents.service";
import { AgentRuntimeConfig } from "../agents/dto/agent.dto";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { ChatMessage, LLMToolCall, LLMToolDefinition } from "../model-providers/dto/llm.dto";
import { RetrievalContext } from "../retrieval/dto/retrieval.dto";
import { RetrievalService } from "../retrieval/retrieval.service";
import { ToolCallLogRecord, ToolDefinition, ToolJsonValue } from "../tools/dto/tool.dto";
import { ToolsService } from "../tools/tools.service";
import { WorkflowRuntimeEvent } from "../workflow_runtime/dto/workflow-run.dto";
import { WorkflowRuntimeService } from "../workflow_runtime/workflow-runtime.service";
import { WorkflowToolRunsService } from "../workflow_runtime/workflow-tool-runs.service";
import { AgentRunRequest } from "./dto/agent-run.dto";
import { AgentRuntimeEvent } from "./dto/runtime-event.dto";
import { AgentPromptBuilder } from "./prompt-builder";
import { SkillPromptRenderer } from "./skill-renderer";
import { MAX_MODEL_HISTORY_BYTES, sanitizeHistory } from "./history-policy";

const MAX_TOOL_ROUNDS = 3;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

export type AgentRuntimeTrace = {
  runId: string;
  requestId: string;
  nextSequence: number;
  firstTokenRecorded: boolean;
  terminal: boolean;
};

export type AgentRuntimeTraceStep = {
  stepId: string;
};

@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    @Optional() private readonly agentRunsService?: AgentRunsService,
    @Optional() private readonly agentsService?: AgentsService,
    @Optional() private readonly modelProvidersService?: ModelProvidersService,
    @Optional() private readonly toolsService?: ToolsService,
    @Optional() private readonly retrievalService?: RetrievalService,
    @Optional() private readonly promptBuilder?: AgentPromptBuilder,
    @Optional() private readonly workflowRuntimeService?: WorkflowRuntimeService,
    @Optional() private readonly workflowToolRunsService?: WorkflowToolRunsService,
    @Optional() private readonly skillPromptRenderer?: SkillPromptRenderer
  ) {}

  /**
   * 执行完整 Agent Run，并直接产生协议无关 Runtime Event。
   * Chat、外部访问和未来 Job/Subagent 都只能通过该入口驱动模型、检索和工具循环。
   */
  async *runAgent(request: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
    let trace: AgentRuntimeTrace | undefined;

    try {
      const agent = await this.requireAgentsService().getAgentRuntimeConfig(request.agentId);
      const historyResult = sanitizeHistory(request.history, {
        maxTurns: agent.historyTurns,
        maxTotalBytes: MAX_MODEL_HISTORY_BYTES,
        violationSource: "runtime"
      });

      if (historyResult.droppedMessages > 0) {
        this.logger.warn(
          `Runtime history policy dropped ${historyResult.droppedMessages} message(s) for request ${request.requestId}`
        );
      }

      trace = await this.createTrace({
        requestId: request.requestId,
        source: request.source,
        agentId: agent.agentId,
        userId: request.userId,
        sessionId: request.sessionId,
        externalConversationId: request.externalConversationId,
        inputPreview: request.message.text,
        modelConfigId:
          agent.executionMode === AgentExecutionMode.WORKFLOW ? undefined : agent.modelConfigId,
        workflowId: agent.workflow?.workflowId,
        workflowVersionId: agent.workflow?.workflowVersionId,
        workflowRunMode:
          agent.executionMode === AgentExecutionMode.WORKFLOW
            ? WorkflowRunMode.PUBLISHED
            : undefined
      });
      let selectedModelConfigId = agent.modelConfigId;
      let selectedModelName = agent.modelName;
      let selectedProviderName = agent.providerType;
      const visionPolicy = agent.vision ?? {
        mode: "AUTO" as const,
        visionModelConfigId: null
      };
      if (agent.executionMode !== AgentExecutionMode.WORKFLOW) {
        const requiredCapabilities = [
          ModelCapabilityType.TEXT_CHAT,
          ...((request.message.images?.length ?? 0) > 0 ? [ModelCapabilityType.VISION_INPUT] : [])
        ];
        const routeStep = await this.startStep(trace, AgentRunStepType.ROUTER, "model_route", {
          primaryModelConfigId: agent.modelConfigId,
          requiredCapabilities,
          visionMode: visionPolicy.mode,
          attachmentCount: request.message.images?.length ?? 0
        });
        try {
          const modelProviders = this.requireModelProvidersService();
          const decision =
            typeof modelProviders.resolveChatModel === "function"
              ? await modelProviders.resolveChatModel({
                  primaryModelConfigId: agent.modelConfigId,
                  requiredCapabilities,
                  policy: {
                    visionMode: visionPolicy.mode,
                    visionModelConfigId: visionPolicy.visionModelConfigId
                  },
                  requestId: request.requestId
                })
              : {
                  selectedModelConfigId: agent.modelConfigId,
                  selectedRole: "PRIMARY" as const,
                  requiredCapabilities,
                  reason: "PRIMARY_SUPPORTS_ALL" as const,
                  fallbackUsed: false
                };
          selectedModelConfigId = decision.selectedModelConfigId;
          if (
            request.message.images?.length &&
            typeof modelProviders.validateVisionInput === "function"
          ) {
            await modelProviders.validateVisionInput(selectedModelConfigId, request.message.images);
          }
          if (selectedModelConfigId !== agent.modelConfigId) {
            const selected =
              await this.requireModelProvidersService().getModelConfig(selectedModelConfigId);
            selectedModelName = selected.modelName;
            selectedProviderName = selected.provider.providerType;
          }
          await this.completeStep(routeStep, decision);
        } catch (error) {
          await this.failStep(routeStep, this.normalizeError(error, "model_route_failed"));
          throw error;
        }
      }
      yield {
        type: "run_started",
        data: {
          runId: trace?.runId,
          agentId: agent.agentId,
          modelConfigId: selectedModelConfigId,
          modelName: selectedModelName,
          providerName: selectedProviderName,
          sessionId: request.sessionId ?? null,
          executionMode: agent.executionMode,
          workflowId: agent.workflow?.workflowId,
          workflowVersionId: agent.workflow?.workflowVersionId
        }
      };

      if (agent.executionMode === AgentExecutionMode.WORKFLOW) {
        yield* this.runWorkflowAgent({ ...request, history: historyResult.messages }, agent, trace);
        return;
      }

      const workflowToolIds = agent.toolIds.filter((toolId) => toolId.startsWith("workflow:"));
      const regularToolIds = agent.toolIds.filter((toolId) => !toolId.startsWith("workflow:"));
      const toolSearchStep =
        regularToolIds.length > 20
          ? await this.startStep(trace, AgentRunStepType.TOOL_SEARCH, "tool_catalog_search", {
              query: request.message.text,
              boundToolCount: regularToolIds.length,
              candidateLimit: 12
            })
          : undefined;
      if (toolSearchStep) {
        yield { type: "tool_search_started", data: { boundToolCount: regularToolIds.length } };
      }
      const [toolSearch, workflowTools] = await Promise.all([
        this.searchToolDefinitions(regularToolIds, request.message.text, agent.systemPrompt),
        workflowToolIds.length
          ? this.requireWorkflowRuntimeService().getWorkflowToolDefinitions(workflowToolIds)
          : Promise.resolve([])
      ]);
      if (toolSearchStep) {
        await this.completeStep(toolSearchStep, {
          boundToolCount: toolSearch.boundToolCount,
          catalogMatchCount: toolSearch.catalogMatchCount,
          selectedToolIds: toolSearch.selectedToolIds
        });
        yield {
          type: "tool_search_completed",
          data: {
            boundToolCount: toolSearch.boundToolCount,
            catalogMatchCount: toolSearch.catalogMatchCount,
            selectedToolIds: toolSearch.selectedToolIds
          }
        };
      }
      const definitions = new Map(
        [...toolSearch.definitions, ...workflowTools].map((definition) => [
          definition.id,
          definition
        ])
      );
      // Agent 的绑定顺序决定模型看到的工具顺序，不能按来源分组后隐式重排。
      const toolDefinitions = agent.toolIds.flatMap((toolId) => {
        const definition = definitions.get(toolId);
        return definition ? [definition] : [];
      });
      const llmTools = this.toLLMToolDefinitions(toolDefinitions);
      await this.recordToolAvailability({
        requestId: request.requestId,
        runId: trace?.runId,
        agentId: agent.agentId,
        userId: request.userId,
        toolIds: agent.toolIds,
        toolDefinitions
      });

      let retrievalContext: RetrievalContext | null = null;
      if (agent.knowledgeBaseIds.length > 0) {
        yield { type: "retrieval_started", data: { knowledgeBaseIds: agent.knowledgeBaseIds } };
        retrievalContext = await this.retrieveKnowledgeContext(
          request.message.text,
          agent.knowledgeBaseIds,
          trace
        );
        yield {
          type: "retrieval_completed",
          data: {
            elapsedMs: retrievalContext.elapsedMs,
            diagnostics: retrievalContext.diagnostics,
            sources: retrievalContext.sources.map((source) => ({
              knowledgeBaseId: source.knowledgeBaseId,
              documentId: source.documentId,
              documentName: source.documentName,
              chunkId: source.chunkId,
              chunkIndex: source.chunkIndex,
              score: source.score,
              ...(source.matchedBy ? { matchedBy: source.matchedBy } : {}),
              ...(source.vectorScore !== undefined ? { vectorScore: source.vectorScore } : {}),
              ...(source.keywordScore !== undefined ? { keywordScore: source.keywordScore } : {}),
              ...(source.fusionScore !== undefined ? { fusionScore: source.fusionScore } : {}),
              contentPreview: this.requirePromptBuilder().formatRetrievalSourcePreview(
                source.content
              )
            }))
          }
        };
      }

      const skillPromptStep = await this.startStep(
        trace,
        AgentRunStepType.TRANSFORM,
        "skill_prompt",
        {
          bindings: (agent.skills ?? []).map((skill) => ({
            skillId: skill.id,
            position: skill.position
          }))
        }
      );
      const renderedSkills = this.requireSkillPromptRenderer().render(
        agent.skills ?? [],
        agent.unavailableSkillBindings ?? []
      );
      await this.completeStep(skillPromptStep, {
        applied: renderedSkills.applied,
        skipped: renderedSkills.skipped,
        totalRenderedChars: renderedSkills.totalRenderedChars,
        promptHash: renderedSkills.promptHash
      });

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: this.requirePromptBuilder().buildSystemPrompt({
            systemPrompt: agent.systemPrompt,
            query: request.message.text,
            skillPrompt: renderedSkills.prompt,
            tools: llmTools,
            retrievalContext
          })
        },
        ...historyResult.messages,
        this.buildUserMessage(request.message)
      ];
      const promptRuleCall = this.inferPromptRuleToolCall(
        request.message.text,
        agent.systemPrompt,
        llmTools
      );
      const inferred = promptRuleCall ?? this.inferToolCall(request.message.text, llmTools);
      if (inferred) {
        yield* this.executeToolCalls(
          [inferred],
          messages,
          request,
          agent.agentId,
          trace,
          promptRuleCall ? "prompt_rule" : "inferred"
        );
      }

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        let toolCalls: LLMToolCall[] = [];
        let source = "model_native";
        let assistantContent = "";
        const bufferedTokens: string[] = [];
        const modelCallStartedAt = Date.now();
        let firstUpstreamEventMs: number | undefined;
        let firstReasoningTokenMs: number | undefined;
        let firstContentTokenMs: number | undefined;
        let reasoningCharacterCount = 0;
        const modelStep = await this.startStep(trace, AgentRunStepType.MODEL, "chat_stream", {
          round,
          modelConfigId: selectedModelConfigId,
          messageCount: messages.length,
          toolCount: llmTools.length
        });

        try {
          for await (const chunk of this.requireModelProvidersService().streamChatCompletion({
            modelConfigId: selectedModelConfigId,
            messages,
            tools: llmTools,
            toolChoice: llmTools.length > 0 ? "auto" : undefined,
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            timeoutSeconds: agent.timeoutSeconds,
            thinkingMode: agent.thinkingMode,
            signal: request.signal
          })) {
            if (chunk.type !== "done" && firstUpstreamEventMs === undefined) {
              firstUpstreamEventMs = Date.now() - modelCallStartedAt;
            }
            if (chunk.type === "token" && chunk.content) {
              firstContentTokenMs ??= Date.now() - modelCallStartedAt;
              assistantContent += chunk.content;
              await this.markFirstToken(trace);
              if (llmTools.length > 0) bufferedTokens.push(chunk.content);
              else yield { type: "token", data: { content: chunk.content } };
            } else if (chunk.type === "reasoning_token" && chunk.content) {
              // 只记录推理存在性和延迟，不保存或向用户输出完整思维链。
              firstReasoningTokenMs ??= Date.now() - modelCallStartedAt;
              reasoningCharacterCount += chunk.content.length;
            } else if (chunk.type === "tool_call") {
              toolCalls.push(chunk.toolCall);
            } else if (chunk.type === "error") {
              const error = {
                type: "model_stream_failed",
                message: chunk.errorMessage || "model stream failed"
              };
              await this.failStep(modelStep, error);
              await this.failTrace(trace, error);
              yield {
                type: "run_failed",
                data: { runId: trace?.runId, error: this.toPublicError(error) }
              };
              return;
            }
          }
        } catch (error) {
          await this.failStep(modelStep, this.normalizeError(error));
          throw error;
        }

        await this.completeStep(modelStep, {
          contentPreview: assistantContent,
          toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name })),
          telemetry: {
            firstUpstreamEventMs: firstUpstreamEventMs ?? null,
            firstReasoningTokenMs: firstReasoningTokenMs ?? null,
            firstContentTokenMs: firstContentTokenMs ?? null,
            reasoningObserved: reasoningCharacterCount > 0,
            reasoningCharacterCount
          }
        });
        if (toolCalls.length === 0) {
          toolCalls = this.parseTextToolCalls(assistantContent, llmTools);
          if (toolCalls.length > 0) source = "text_json";
        }
        if (toolCalls.length === 0 && round === 0 && !inferred) {
          const routedToolCall = await this.routeToolCall({
            message: request.message.text,
            systemPrompt: agent.systemPrompt,
            modelConfigId: selectedModelConfigId,
            timeoutSeconds: agent.timeoutSeconds,
            tools: llmTools,
            signal: request.signal,
            trace
          });
          if (routedToolCall) {
            toolCalls = [routedToolCall];
            source = "model_router";
            // 首轮回答已经被路由器判定为应该调用工具，不能再把其中的臆测内容带入后续模型上下文。
            assistantContent = "";
          }
        }
        if (toolCalls.length === 0) {
          if (llmTools.length > 0) {
            await this.recordToolCallLog({
              requestId: request.requestId,
              runId: trace?.runId,
              agentId: agent.agentId,
              userId: request.userId,
              status: "skipped",
              source: "model_response",
              reason: "model_returned_no_tool_call",
              output: { assistantContentPreview: assistantContent.slice(0, 500) }
            });
          }
          const fallback = this.getToolResultFallbackAnswer(messages, assistantContent);
          const content =
            fallback || (llmTools.length > 0 ? bufferedTokens.join("") : assistantContent);
          if (fallback) yield { type: "token", data: { content: fallback } };
          else
            for (const token of bufferedTokens) yield { type: "token", data: { content: token } };
          await this.completeTrace(trace, content);
          yield {
            type: "run_completed",
            data: {
              runId: trace?.runId,
              agentId: agent.agentId,
              modelConfigId: selectedModelConfigId,
              modelName: selectedModelName,
              providerName: selectedProviderName,
              sessionId: request.sessionId ?? null,
              content
            }
          };
          return;
        }
        if (round >= MAX_TOOL_ROUNDS) {
          const error = { type: "tool_round_limit_exceeded", message: "tool call rounds exceeded" };
          await this.failTrace(trace, error);
          yield {
            type: "run_failed",
            data: { runId: trace?.runId, error: this.toPublicError(error) }
          };
          return;
        }
        yield* this.executeToolCalls(
          toolCalls,
          messages,
          request,
          agent.agentId,
          trace,
          source,
          assistantContent
        );
      }
    } catch (error) {
      await this.finishInterruptedTrace(trace, request.signal, error);
      if (request.signal?.aborted) {
        yield { type: "run_canceled", data: { runId: trace?.runId } };
      } else {
        yield {
          type: "run_failed",
          data: { runId: trace?.runId, error: this.toPublicError(this.normalizeError(error)) }
        };
      }
    } finally {
      if (trace && !trace.terminal) await this.finishInterruptedTrace(trace, request.signal);
    }
  }

  /**
   * 将已发布 Workflow 的节点事件桥接为统一 Agent Runtime Event，并同步写入 Run Step。
   * 三类 Chat 入口只消费 Agent Event，因此不会感知底层是自主循环还是确定性 Workflow。
   */
  private async *runWorkflowAgent(
    request: AgentRunRequest,
    agent: AgentRuntimeConfig,
    trace: AgentRuntimeTrace | undefined
  ): AsyncIterable<AgentRuntimeEvent> {
    const binding = agent.workflow;
    if (!binding) {
      throw new Error("WORKFLOW 模式的 Agent 缺少已发布 Workflow Version");
    }

    const activeSteps = new Map<string, AgentRuntimeTraceStep | undefined>();
    for await (const event of this.requireWorkflowRuntimeService().runWorkflow({
      requestId: request.requestId,
      runId: trace?.runId,
      agentId: agent.agentId,
      userId: request.userId,
      sessionId: request.sessionId,
      workflowId: binding.workflowId,
      workflowVersionId: binding.workflowVersionId,
      mode: WorkflowRunMode.PUBLISHED,
      inputs: this.buildWorkflowInputs(request),
      signal: request.signal
    })) {
      if (event.type === "workflow_started") continue;

      if (event.type === "node_started") {
        const nodeId = this.eventString(event, "nodeId");
        const nodeType = this.eventString(event, "nodeType");
        const name = this.eventString(event, "name") || nodeId;
        const attempt = this.eventPositiveInteger(event, "attempt") ?? 1;
        const step = await this.startStep(
          trace,
          this.toWorkflowStepType(nodeType),
          name,
          { nodeType, attempt },
          { nodeId, attempt }
        );
        activeSteps.set(nodeId, step);
        continue;
      }

      if (event.type === "token") {
        await this.markFirstToken(trace);
        yield event;
        continue;
      }

      if (event.type === "node_completed") {
        const nodeId = this.eventString(event, "nodeId");
        const nodeType = this.eventString(event, "nodeType");
        await this.completeStep(activeSteps.get(nodeId), {
          nodeType,
          selectedHandle: this.eventString(event, "nextHandle") || null,
          output: this.toTraceJsonValue(event.data.output)
        });
        activeSteps.delete(nodeId);
        continue;
      }

      if (event.type === "node_failed") {
        const nodeId = this.eventString(event, "nodeId");
        const error = this.readWorkflowError(event);
        await this.failStep(activeSteps.get(nodeId), error);
        activeSteps.delete(nodeId);
        continue;
      }

      if (event.type === "workflow_completed") {
        const content = this.eventString(event, "answer");
        if (!content) {
          const error = {
            type: "workflow_answer_missing",
            message: "Workflow End 节点必须返回非空 answer"
          };
          await this.failTrace(trace, error);
          yield {
            type: "run_failed",
            data: { runId: trace?.runId, error: this.toPublicError(error) }
          };
          return;
        }
        await this.completeTrace(trace, content);
        yield {
          type: "run_completed",
          data: {
            runId: trace?.runId,
            agentId: agent.agentId,
            modelConfigId: agent.modelConfigId,
            modelName: agent.modelName,
            providerName: agent.providerType,
            sessionId: request.sessionId ?? null,
            content,
            executionMode: AgentExecutionMode.WORKFLOW,
            workflowId: binding.workflowId,
            workflowVersionId: binding.workflowVersionId
          }
        };
        return;
      }

      if (event.type === "workflow_failed") {
        const error = this.readWorkflowError(event);
        await this.failTrace(trace, error);
        yield {
          type: "run_failed",
          data: { runId: trace?.runId, error: this.toWorkflowPublicError(event) }
        };
        return;
      }

      if (event.type === "workflow_canceled") {
        await this.cancelTrace(trace);
        yield { type: "run_canceled", data: { runId: trace?.runId } };
        return;
      }
    }

    throw new Error("Workflow Runtime 未返回终态事件");
  }

  /** Chat 输入使用固定业务字段投影；Start 节点只会保留自己声明的字段。 */
  private buildWorkflowInputs(request: AgentRunRequest): Record<string, unknown> {
    return {
      query: request.message.text,
      message: request.message.text,
      history: request.history,
      images: request.message.images ?? [],
      files: request.message.files ?? [],
      sessionId: request.sessionId ?? null
    };
  }

  /** Workflow 节点类型映射为稳定 Step 类型，未知扩展节点先归到 WORKFLOW。 */
  private toWorkflowStepType(nodeType: string): AgentRunStepType {
    const mapping: Record<string, AgentRunStepType> = {
      start: AgentRunStepType.WORKFLOW,
      end: AgentRunStepType.WORKFLOW,
      llm: AgentRunStepType.MODEL,
      retrieval: AgentRunStepType.RETRIEVAL,
      tool: AgentRunStepType.TOOL,
      condition: AgentRunStepType.CONDITION,
      template: AgentRunStepType.TRANSFORM
    };
    return mapping[nodeType] ?? AgentRunStepType.WORKFLOW;
  }

  /** Runtime Event 字段只按预期类型读取，避免异常事件对象污染 Trace。 */
  private eventString(event: WorkflowRuntimeEvent, field: string): string {
    const value = (event.data as Record<string, unknown>)[field];
    return typeof value === "string" ? value : "";
  }

  /** attempt 只接受正整数，历史或扩展事件缺失时由调用方回退为 1。 */
  private eventPositiveInteger(event: WorkflowRuntimeEvent, field: string): number | undefined {
    const value = (event.data as Record<string, unknown>)[field];
    return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
  }

  /** 节点及 Workflow 失败统一提取安全错误字段，不持久化异常对象和堆栈。 */
  private readWorkflowError(event: WorkflowRuntimeEvent): AgentRunErrorDto {
    const value = (event.data as Record<string, unknown>).error;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { type: "workflow_failed", message: "Workflow 执行失败" };
    }
    const error = value as Record<string, unknown>;
    return {
      type: typeof error.type === "string" ? error.type : "workflow_failed",
      message: typeof error.message === "string" ? error.message : "Workflow 执行失败"
    };
  }

  /** Workflow Runtime 已计算 retryable，Agent 层只补充公开消息并保持原分类。 */
  private toWorkflowPublicError(event: WorkflowRuntimeEvent): RuntimeError {
    const error = this.readWorkflowError(event);
    const raw = (event.data as Record<string, unknown>).error;
    const retryable =
      Boolean(raw) &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as Record<string, unknown>).retryable === true;
    return { ...error, publicMessage: error.message, retryable };
  }

  /** 未知节点输出递归收敛为 Trace JSON；undefined、函数和非有限数统一写 null。 */
  private toTraceJsonValue(value: unknown): TraceJsonValue {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
    if (Array.isArray(value)) return value.map((item) => this.toTraceJsonValue(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.toTraceJsonValue(item)])
      );
    }
    return null;
  }

  /** HTTP 入口沿用调用方 request ID，内部任务和旧调用方回退生成 UUID。 */
  resolveRequestId(requestId?: string): string {
    return requestId?.trim() || randomUUID();
  }

  /** 创建并启动 Run；Trace 存储是弱依赖，写入失败不能阻断 Agent 主流程。 */
  async createTrace(request: {
    requestId: string;
    source: AgentRunSource;
    agentId: string;
    userId?: string;
    sessionId?: string;
    externalConversationId?: string;
    inputPreview: string;
    modelConfigId?: string;
    workflowId?: string;
    workflowVersionId?: string;
    workflowRunMode?: WorkflowRunMode;
  }): Promise<AgentRuntimeTrace | undefined> {
    if (!this.agentRunsService) {
      return undefined;
    }

    try {
      const run = await this.agentRunsService.createRun(request);
      await this.agentRunsService.startRun(run.runId, request.modelConfigId);
      return {
        runId: run.runId,
        requestId: run.requestId,
        nextSequence: 1,
        firstTokenRecorded: false,
        terminal: false
      };
    } catch (error) {
      this.logTraceFailure("创建 Agent Run 失败", error);
      return undefined;
    }
  }

  /** 创建顺序稳定的 Run Step；失败时返回空值，让实际 Agent 调用继续执行。 */
  async startStep(
    trace: AgentRuntimeTrace | undefined,
    type: AgentRunStepType,
    name: string,
    input?: TraceJsonValue,
    metadata?: { nodeId?: string; attempt?: number }
  ): Promise<AgentRuntimeTraceStep | undefined> {
    if (!trace || !this.agentRunsService || trace.terminal) {
      return undefined;
    }

    const sequence = trace.nextSequence;
    trace.nextSequence += 1;

    try {
      const step = await this.agentRunsService.startStep({
        runId: trace.runId,
        sequence,
        type,
        name,
        input,
        ...(metadata?.nodeId ? { nodeId: metadata.nodeId } : {}),
        ...(metadata?.attempt ? { attempt: metadata.attempt } : {})
      });
      return { stepId: step.stepId };
    } catch (error) {
      this.logTraceFailure(`创建 Agent Run Step 失败: ${name}`, error);
      return undefined;
    }
  }

  /** 完成 Step，输出的脱敏和截断统一交给 AgentRunsService。 */
  async completeStep(
    step: AgentRuntimeTraceStep | undefined,
    output?: TraceJsonValue
  ): Promise<void> {
    if (!step || !this.agentRunsService) {
      return;
    }

    try {
      await this.agentRunsService.completeStep(step.stepId, output);
    } catch (error) {
      this.logTraceFailure(`完成 Agent Run Step 失败: ${step.stepId}`, error);
    }
  }

  /** 标记 Step 失败，同时隔离 Trace 异常，避免覆盖原始业务错误。 */
  async failStep(step: AgentRuntimeTraceStep | undefined, error: AgentRunErrorDto): Promise<void> {
    if (!step || !this.agentRunsService) {
      return;
    }

    try {
      await this.agentRunsService.failStep(step.stepId, error);
    } catch (traceError) {
      this.logTraceFailure(`结束失败 Agent Run Step 失败: ${step.stepId}`, traceError);
    }
  }

  /** 审批挂起属于可恢复状态，Trace 写入失败仍不能阻断真实 SSE 等待。 */
  private async waitTraceForApproval(
    trace: AgentRuntimeTrace | undefined,
    step: AgentRuntimeTraceStep | undefined
  ): Promise<void> {
    if (!trace || !step || !this.agentRunsService || trace.terminal) return;
    try {
      await this.agentRunsService.waitForApproval(trace.runId, step.stepId);
    } catch (error) {
      this.logTraceFailure(`挂起 Agent Run 审批失败: ${trace.runId}`, error);
    }
  }

  /** 批准和拒绝都先恢复运行态，再由既有完成/失败路径收敛同一个 Tool Step。 */
  private async resumeTraceAfterApproval(
    trace: AgentRuntimeTrace | undefined,
    step: AgentRuntimeTraceStep | undefined
  ): Promise<void> {
    if (!trace || !step || !this.agentRunsService || trace.terminal) return;
    try {
      await this.agentRunsService.resumeAfterApproval(trace.runId, step.stepId);
    } catch (error) {
      this.logTraceFailure(`恢复 Agent Run 审批失败: ${trace.runId}`, error);
    }
  }

  /** Workflow 主动取消时直接收敛 Run，不能依赖调用方 Signal 一定仍处于 aborted 状态。 */
  async cancelTrace(trace: AgentRuntimeTrace | undefined): Promise<void> {
    if (!trace || trace.terminal) return;
    trace.terminal = true;
    try {
      await this.agentRunsService?.cancelRun(trace.runId);
    } catch (error) {
      this.logTraceFailure(`取消 Agent Run 失败: ${trace.runId}`, error);
    }
  }

  /** 每个 Run 只记录一次首 Token 时间，避免逐 Token 更新数据库。 */
  async markFirstToken(trace?: AgentRuntimeTrace): Promise<void> {
    if (!trace || !this.agentRunsService || trace.terminal || trace.firstTokenRecorded) {
      return;
    }

    trace.firstTokenRecorded = true;

    try {
      await this.agentRunsService.markFirstToken(trace.runId);
    } catch (error) {
      this.logTraceFailure(`记录首 Token 失败: ${trace.runId}`, error);
    }
  }

  /** 完成 Run 并记录回答摘要；先设置内存终态，防止 finally 重复收敛。 */
  async completeTrace(
    trace: AgentRuntimeTrace | undefined,
    content: string,
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  ): Promise<void> {
    if (!trace || trace.terminal) {
      return;
    }

    trace.terminal = true;

    if (!this.agentRunsService) {
      return;
    }

    try {
      await this.agentRunsService.completeRun(trace.runId, {
        outputPreview: content,
        inputTokens: usage?.promptTokens,
        outputTokens: usage?.completionTokens
      });
    } catch (error) {
      this.logTraceFailure(`完成 Agent Run 失败: ${trace.runId}`, error);
    }
  }

  /** 将 Run 收敛到失败终态，并保持调用幂等。 */
  async failTrace(trace: AgentRuntimeTrace | undefined, error: AgentRunErrorDto): Promise<void> {
    if (!trace || trace.terminal) {
      return;
    }

    trace.terminal = true;

    if (!this.agentRunsService) {
      return;
    }

    try {
      await this.agentRunsService.failRun(trace.runId, error);
    } catch (traceError) {
      this.logTraceFailure(`标记 Agent Run 失败: ${trace.runId}`, traceError);
    }
  }

  /** 根据 AbortSignal 将未正常结束的流区分为用户取消和执行失败。 */
  async finishInterruptedTrace(
    trace: AgentRuntimeTrace | undefined,
    signal?: AbortSignal,
    error?: unknown
  ): Promise<void> {
    if (!trace || trace.terminal) {
      return;
    }

    if (signal?.aborted) {
      trace.terminal = true;

      try {
        await this.agentRunsService?.cancelRun(trace.runId);
      } catch (traceError) {
        this.logTraceFailure(`取消 Agent Run 失败: ${trace.runId}`, traceError);
      }
      return;
    }

    await this.failTrace(
      trace,
      error
        ? this.normalizeError(error)
        : { type: "stream_interrupted", message: "流式响应在完成前结束" }
    );
  }

  /** 把未知异常转换为稳定错误分类，不把堆栈或底层对象写入 Trace。 */
  normalizeError(error: unknown, fallbackType = "internal_error"): AgentRunErrorDto {
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      return { type: "canceled", message: "调用已取消" };
    }

    return {
      type: fallbackType,
      message: error instanceof Error && error.message ? error.message : "Agent 执行失败"
    };
  }

  /** 生成面向客户端的错误对象，隐藏堆栈并标记允许重试的瞬态错误。 */
  toPublicError(error: AgentRunErrorDto): RuntimeError {
    return {
      type: error.type,
      message: error.message,
      publicMessage: error.message || "Agent 执行失败",
      retryable: [
        "model_unavailable",
        "model_rate_limited",
        "model_timeout",
        "retrieval_failed"
      ].includes(error.type)
    };
  }

  /** 将 Mia 工具定义转换为模型网关使用的统一工具协议。 */
  private toLLMToolDefinitions(tools: ToolDefinition[]): LLMToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.id,
      // HTTP Tool 的函数名是稳定 UUID；把管理端名称并入描述，模型才能将 Prompt 中的业务名称映射到函数 ID。
      description: tool.description ? `${tool.name}：${tool.description}` : tool.name,
      parameters: tool.inputSchema
    }));
  }

  /**
   * 弱模型忽略原生 tools 时，用一次非流式、低温度调用只做工具路由。
   * 路由器允许返回 none，因此不会把所有普通对话都强制变成工具调用。
   */
  private async routeToolCall(request: {
    message: string;
    systemPrompt: string;
    modelConfigId: string;
    timeoutSeconds: number;
    tools: LLMToolDefinition[];
    signal?: AbortSignal;
    trace?: AgentRuntimeTrace;
  }): Promise<LLMToolCall | null> {
    if (request.tools.length === 0) return null;
    const createCompletion = (
      this.modelProvidersService as Partial<ModelProvidersService> | undefined
    )?.createChatCompletion;
    if (typeof createCompletion !== "function") return null;

    const step = await this.startStep(request.trace, AgentRunStepType.MODEL, "tool_router", {
      modelConfigId: request.modelConfigId,
      toolCount: request.tools.length
    });
    const toolList = request.tools
      .map(
        (tool) =>
          `- ${tool.name}: ${tool.description}; parameters=${JSON.stringify(tool.parameters)}`
      )
      .join("\n");

    try {
      const response = await createCompletion.call(this.modelProvidersService, {
        modelConfigId: request.modelConfigId,
        messages: [
          {
            role: "system",
            content: [
              "你是工具路由器，不回答用户问题。",
              "判断用户请求是否必须调用下列工具才能获得实时、外部或精确结果。",
              '需要调用时，只输出 {"name":"工具ID","arguments":{}}。',
              '不需要调用时，只输出 {"name":"none","arguments":{}}。',
              "arguments 必须符合工具 parameters；不要输出 Markdown、解释或虚构结果。",
              "Agent 规则：",
              request.systemPrompt,
              "可用工具：",
              toolList
            ].join("\n")
          },
          { role: "user", content: request.message }
        ],
        temperature: 0,
        maxTokens: 500,
        timeoutSeconds: request.timeoutSeconds,
        signal: request.signal
      });
      const parsed = this.parseToolCallJson(response.content);
      const selected = parsed ? request.tools.find((tool) => tool.name === parsed.name) : undefined;
      await this.completeStep(step, {
        selectedToolId: selected?.name ?? null,
        contentPreview: response.content.slice(0, 500)
      });
      if (!parsed || !selected) return null;
      return {
        id: this.createToolCallId(parsed.name),
        name: parsed.name,
        arguments: parsed.arguments,
        rawArguments: JSON.stringify(parsed.arguments)
      };
    } catch (error) {
      // 路由增强是兼容性回退；失败时保留原模型回答，不让额外判断拖垮主对话。
      await this.failStep(step, this.normalizeError(error));
      return null;
    }
  }

  /** 记录本次 Run 实际可见的工具集合，便于解释模型为何没有调用工具。 */
  private async recordToolAvailability(request: {
    requestId: string;
    runId?: string;
    agentId: string;
    userId?: string;
    toolIds: string[];
    toolDefinitions: ToolDefinition[];
  }): Promise<void> {
    const enabledToolIds = request.toolDefinitions.map((tool) => tool.id);
    const status =
      request.toolIds.length > 0 && enabledToolIds.length > 0 ? "available" : "skipped";
    const reason =
      request.toolIds.length === 0
        ? "agent_has_no_bound_tools"
        : enabledToolIds.length === 0
          ? "bound_tools_not_available"
          : undefined;
    await this.recordToolCallLog({
      requestId: request.requestId,
      runId: request.runId,
      agentId: request.agentId,
      userId: request.userId,
      status,
      source: "chat_start",
      reason,
      output: { boundToolIds: request.toolIds, enabledToolIds }
    });
  }

  /** 兼容精简测试替身；旧替身没有 Tool Search 时退回完整定义加载。 */
  private async searchToolDefinitions(toolIds: string[], query: string, systemPrompt: string) {
    const searcher = (this.toolsService as Partial<ToolsService> | undefined)
      ?.searchToolDefinitions;
    if (typeof searcher === "function") {
      return searcher.call(this.toolsService, toolIds, query, systemPrompt);
    }
    const definitions = await this.requireToolsService().getToolDefinitions(toolIds);
    return {
      definitions,
      searched: false,
      boundToolCount: toolIds.length,
      catalogMatchCount: definitions.length,
      selectedToolIds: definitions.map((tool) => tool.id)
    };
  }

  /** 兼容精简测试替身；工具审计缺失不能阻断模型回答。 */
  private async recordToolCallLog(record: ToolCallLogRecord): Promise<void> {
    const logger = (this.toolsService as Partial<ToolsService> | undefined)?.recordToolCallLog;
    if (typeof logger === "function") await logger.call(this.toolsService, record);
  }

  /** 兼容旧测试替身；正式运行时由 ToolsService 按工具配置执行字段级脱敏。 */
  private async sanitizeToolInput(
    toolId: string,
    input: Record<string, ToolJsonValue>
  ): Promise<Record<string, ToolJsonValue>> {
    const sanitizer = (this.toolsService as Partial<ToolsService> | undefined)?.sanitizeToolInput;
    return typeof sanitizer === "function"
      ? sanitizer.call(this.toolsService, toolId, input)
      : input;
  }

  /** 执行知识检索并将输入、来源摘要和失败状态写入同一个 Trace Step。 */
  private async retrieveKnowledgeContext(
    message: string,
    knowledgeBaseIds: string[],
    trace?: AgentRuntimeTrace
  ): Promise<RetrievalContext> {
    const step = await this.startStep(trace, AgentRunStepType.RETRIEVAL, "knowledge_retrieval", {
      queryPreview: message,
      knowledgeBaseIds
    });
    try {
      const context = await this.requireRetrievalService().retrieveKnowledgeContext({
        query: message,
        knowledgeBaseIds
      });
      await this.completeStep(step, {
        elapsedMs: context.elapsedMs,
        chunkCount: context.sources.length,
        diagnostics: context.diagnostics ?? null,
        sources: context.sources.map((source) => ({
          knowledgeBaseId: source.knowledgeBaseId,
          documentId: source.documentId,
          chunkId: source.chunkId,
          score: source.score,
          matchedBy: source.matchedBy ?? [],
          vectorScore: source.vectorScore ?? null,
          keywordScore: source.keywordScore ?? null,
          fusionScore: source.fusionScore ?? null,
          contentPreview: this.requirePromptBuilder().formatRetrievalSourcePreview(source.content)
        }))
      });
      return context;
    } catch (error) {
      await this.failStep(step, this.normalizeError(error, "retrieval_failed"));
      throw error;
    }
  }

  /** 组装支持文本、文件正文和图片 Data URL 的统一用户消息。 */
  private buildUserMessage(message: AgentRunRequest["message"]): ChatMessage {
    const files = message.files ?? [];
    const text = files.length
      ? [
          message.text,
          "",
          ...files.flatMap((file, index) => [
            `文件 ${index + 1}: ${file.name}`,
            `MIME: ${file.mimeType || "text/plain"}`,
            file.content,
            ""
          ])
        ].join("\n")
      : message.text;
    const images = message.images ?? [];
    if (images.length === 0) return { role: "user", content: text };
    return {
      role: "user",
      content: [
        { type: "text", text },
        ...images.map((image) => ({
          type: "image" as const,
          mimeType: image.mimeType,
          dataUrl: image.dataUrl
        }))
      ]
    };
  }

  /** 对明确的当前时间问题做确定性工具推断，降低弱模型漏调工具的概率。 */
  private inferToolCall(message: string, tools: LLMToolDefinition[]): LLMToolCall | null {
    if (!tools.some((tool) => tool.name === "current_time")) return null;
    if (
      !/(当前时间|现在几点|现在时间|今天|日期|星期|几点了|时间|time now|current time)/iu.test(
        message
      )
    )
      return null;
    return {
      id: this.createToolCallId("current_time"),
      name: "current_time",
      arguments: { timezone: this.extractTimezone(message) ?? DEFAULT_TIMEZONE },
      rawArguments: ""
    };
  }

  /**
   * 将 System Prompt 中“当用户问 X 时，使用 Y 工具”的显式规则转成确定性调用。
   * 更长的触发语优先，避免“今天穿什么”抢先匹配“今天穿什么颜色”。
   */
  private inferPromptRuleToolCall(
    message: string,
    systemPrompt: string,
    tools: LLMToolDefinition[]
  ): LLMToolCall | null {
    const rules = Array.from(
      systemPrompt.matchAll(/当用户(?:问|询问)\s*(.+?)\s*时[，,]?\s*(?:请)?使用\s*(.+?)工具/giu)
    )
      .map((match) => ({ trigger: match[1].trim(), toolLabel: match[2].trim() }))
      .filter((rule) => rule.trigger && message.includes(rule.trigger))
      .sort((left, right) => right.trigger.length - left.trigger.length);

    for (const rule of rules) {
      const normalizedLabel = this.normalizePromptRuleText(rule.toolLabel);
      const tool = tools.find((candidate) =>
        this.normalizePromptRuleText(candidate.description).includes(normalizedLabel)
      );
      if (!tool) continue;

      const argumentsValue = this.buildPromptRuleArguments(message, systemPrompt, tool.parameters);
      if (!argumentsValue) continue;
      return {
        id: this.createToolCallId(tool.name),
        name: tool.name,
        arguments: argumentsValue,
        rawArguments: JSON.stringify(argumentsValue)
      };
    }
    return null;
  }

  /** 只忽略排版符号，保留业务名称本身，避免 UUID 工具被宽泛关键词误匹配。 */
  private normalizePromptRuleText(value: string): string {
    return value.replace(/[\s：:，,。"'“”‘’]/gu, "").toLocaleLowerCase();
  }

  /**
   * 参数优先取用户本轮显式值，其次读取 Prompt 内 JSON 默认值。
   * 必填参数无法补齐时返回 null，让模型路由器继续判断，避免用残缺参数请求外部接口。
   */
  private buildPromptRuleArguments(
    message: string,
    systemPrompt: string,
    parameters: Record<string, unknown>
  ): Record<string, unknown> | null {
    const properties =
      parameters.properties &&
      typeof parameters.properties === "object" &&
      !Array.isArray(parameters.properties)
        ? (parameters.properties as Record<string, unknown>)
        : {};
    const defaults = Array.from(systemPrompt.matchAll(/\{[^{}]*\}/gu))
      .map((match) => this.parseJsonObject(match[0]))
      .filter((value): value is Record<string, unknown> => value !== null)
      .reduce<Record<string, unknown>>((merged, value) => ({ ...merged, ...value }), {});
    const result: Record<string, unknown> = {};

    for (const [name, schema] of Object.entries(properties)) {
      const explicit = this.extractPromptRuleArgument(message, name, schema);
      const candidate = explicit ?? defaults[name];
      if (candidate !== undefined && this.matchesJsonSchemaType(candidate, schema)) {
        result[name] = candidate;
      }
    }

    const required = Array.isArray(parameters.required)
      ? parameters.required.filter((name): name is string => typeof name === "string")
      : [];
    return required.every((name) => result[name] !== undefined) ? result : null;
  }

  /** 从自然语言中的字段名、经度或纬度后提取简单 JSON 标量。 */
  private extractPromptRuleArgument(message: string, name: string, schema: unknown): unknown {
    const aliases = [
      name,
      ...(name === "longitude" ? ["经度"] : []),
      ...(name === "latitude" ? ["纬度"] : [])
    ];
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const match = message.match(new RegExp(`${escaped}\\s*[:：=]?\\s*([^,，\\s]+)`, "iu"));
      if (!match) continue;
      const type =
        schema && typeof schema === "object" && !Array.isArray(schema)
          ? (schema as Record<string, unknown>).type
          : undefined;
      if (type === "number" || type === "integer") {
        const value = Number(match[1]);
        if (Number.isFinite(value)) return type === "integer" ? Math.trunc(value) : value;
      } else if (type === "boolean" && /^(true|false)$/iu.test(match[1])) {
        return match[1].toLowerCase() === "true";
      } else if (type === "string") {
        return match[1];
      }
    }
    return undefined;
  }

  /** 对确定性路由生成的值执行最小 JSON Schema 类型校验。 */
  private matchesJsonSchemaType(value: unknown, schema: unknown): boolean {
    const type =
      schema && typeof schema === "object" && !Array.isArray(schema)
        ? (schema as Record<string, unknown>).type
        : undefined;
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    if (type === "string") return typeof value === "string";
    if (type === "boolean") return typeof value === "boolean";
    if (type === "array") return Array.isArray(value);
    if (type === "object")
      return value !== null && typeof value === "object" && !Array.isArray(value);
    return true;
  }

  /** 将常见自然语言地区映射为 IANA 时区，未匹配时交由默认时区处理。 */
  private extractTimezone(message: string): string | null {
    if (
      /(美西|洛杉矶|旧金山|西雅图|Los Angeles|San Francisco|Seattle|Pacific Time|PST|PDT)/iu.test(
        message
      )
    )
      return "America/Los_Angeles";
    if (/(美国|美东|纽约|华盛顿|New York|Washington|Eastern Time|EST|EDT)/iu.test(message))
      return "America/New_York";
    if (/(东京|Tokyo)/iu.test(message)) return "Asia/Tokyo";
    if (/(伦敦|London)/iu.test(message)) return "Europe/London";
    if (/(上海|北京|中国|北京时间|Asia\/Shanghai)/iu.test(message)) return DEFAULT_TIMEZONE;
    return null;
  }

  /** 兼容不支持原生 Tool Call 的模型，从纯 JSON 回复中解析工具调用。 */
  private parseTextToolCalls(content: string, tools: LLMToolDefinition[]): LLMToolCall[] {
    if (tools.length === 0 || !content.trim()) return [];
    const parsed = this.parseToolCallJson(content);
    if (!parsed || !tools.some((tool) => tool.name === parsed.name)) return [];
    return [
      {
        id: this.createToolCallId(parsed.name),
        name: parsed.name,
        arguments: parsed.arguments,
        rawArguments: JSON.stringify(parsed.arguments)
      }
    ];
  }

  /** 从 Markdown JSON 代码块或完整文本中读取工具调用；弱模型省略 arguments 时按空对象处理。 */
  private parseToolCallJson(
    content: string
  ): { name: string; arguments: Record<string, unknown> } | null {
    const candidates = [
      ...Array.from(content.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)).map((match) => match[1]),
      content
    ];
    for (const candidate of candidates) {
      const parsed = this.parseJsonObject(candidate.trim());
      if (!parsed || typeof parsed.name !== "string") continue;
      if (parsed.arguments === undefined || parsed.arguments === null) {
        return { name: parsed.name, arguments: {} };
      }
      if (typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)) {
        return { name: parsed.name, arguments: parsed.arguments as Record<string, unknown> };
      }
    }
    return null;
  }

  /** 安全解析 JSON 对象，数组和标量不作为工具参数接受。 */
  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && !Array.isArray(parsed) && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** 顺序执行工具，保证 Runtime Event、ToolCallLog 和 Run Step 使用同一组标识。 */
  private async *executeToolCalls(
    toolCalls: LLMToolCall[],
    messages: ChatMessage[],
    request: AgentRunRequest,
    agentId: string,
    trace: AgentRuntimeTrace | undefined,
    source: string,
    assistantContent = ""
  ): AsyncIterable<AgentRuntimeEvent> {
    messages.push({ role: "assistant", content: assistantContent, toolCalls });
    for (const toolCall of toolCalls) {
      const input = this.toToolInput(toolCall.arguments);
      // 敏感参数只用于真实执行；SSE、Run Step 与 requested 日志统一使用脱敏视图。
      const sanitizedInput = await this.sanitizeToolInput(toolCall.name, input);
      const step = await this.startStep(trace, AgentRunStepType.TOOL, toolCall.name, {
        toolCallId: toolCall.id,
        source,
        input: sanitizedInput
      });
      await this.recordToolCallLog({
        requestId: request.requestId,
        runId: trace?.runId,
        stepId: step?.stepId,
        agentId,
        userId: request.userId,
        toolCallId: toolCall.id,
        toolId: toolCall.name,
        status: "requested",
        source,
        input: sanitizedInput
      });
      yield {
        type: "tool_started",
        data: { id: toolCall.id, name: toolCall.name, arguments: sanitizedInput }
      };
      const executionRequest = {
        toolId: toolCall.name,
        input,
        toolCallId: toolCall.id,
        requestId: request.requestId,
        runId: trace?.runId,
        stepId: step?.stepId,
        agentId,
        userId: request.userId,
        allowInteractiveApproval: request.allowInteractiveToolApproval,
        signal: request.signal
      };
      const isWorkflowTool = toolCall.name.startsWith("workflow:");
      let result = isWorkflowTool
        ? await this.requireWorkflowToolRunsService().execute({
            ...executionRequest,
            runSource: request.source
          })
        : await this.requireToolsService().executeTool(executionRequest);
      let approvalDenied = false;
      if (
        !isWorkflowTool &&
        result.errorType === "mcp_approval_required" &&
        request.allowInteractiveToolApproval
      ) {
        const approval = await this.requireToolsService().createToolApproval(executionRequest);
        await this.waitTraceForApproval(trace, step);
        yield {
          type: "tool_approval_required",
          data: {
            approvalId: approval.id,
            toolCallId: toolCall.id,
            toolId: toolCall.name,
            expiresAt: approval.expiresAt
          }
        };
        const decision = await this.requireToolsService().waitForToolApproval(
          approval.id,
          request.signal
        );
        await this.resumeTraceAfterApproval(trace, step);
        yield {
          type: "tool_approval_resolved",
          data: {
            approvalId: approval.id,
            toolCallId: toolCall.id,
            approved: decision.approved,
            status: decision.status
          }
        };
        result = decision.approved
          ? await this.requireToolsService().executeTool({
              ...executionRequest,
              approvalId: approval.id,
              allowInteractiveApproval: false
            })
          : {
              toolId: toolCall.name,
              ok: false,
              errorType:
                decision.status === "EXPIRED"
                  ? "mcp_approval_expired"
                  : decision.status === "CANCELED"
                    ? "canceled"
                    : "mcp_approval_rejected",
              errorMessage:
                decision.status === "EXPIRED"
                  ? "工具审批已过期"
                  : decision.status === "CANCELED"
                    ? "工具审批已取消"
                    : "用户拒绝了工具调用",
              elapsedMs: 0
            };
        approvalDenied = !decision.approved;
      }
      // 普通工具由 ToolsService 写完成日志；Workflow 绕过该 Service，必须在编排层补齐同一审计闭环。
      if (isWorkflowTool) {
        await this.recordToolCallLog({
          requestId: request.requestId,
          runId: trace?.runId,
          stepId: step?.stepId,
          agentId,
          userId: request.userId,
          toolCallId: toolCall.id,
          toolId: toolCall.name,
          status: result.ok ? "completed" : "failed",
          source,
          input: sanitizedInput,
          output: result.output,
          errorType: result.errorType,
          errorMessage: result.errorMessage,
          elapsedMs: result.elapsedMs
        });
      } else if (approvalDenied) {
        // 拒绝、过期和取消没有进入 ToolsService 执行器，编排层必须补齐最终失败审计。
        await this.recordToolCallLog({
          requestId: request.requestId,
          runId: trace?.runId,
          stepId: step?.stepId,
          agentId,
          userId: request.userId,
          toolCallId: toolCall.id,
          toolId: toolCall.name,
          status: "failed",
          source,
          input: sanitizedInput,
          errorType: result.errorType,
          errorMessage: result.errorMessage,
          elapsedMs: result.elapsedMs
        });
      }
      if (result.ok)
        await this.completeStep(step, {
          ok: true,
          elapsedMs: result.elapsedMs,
          output: result.output ?? null
        });
      else
        await this.failStep(step, {
          type: result.errorType || "tool_execution_failed",
          message: result.errorMessage || "工具调用失败"
        });
      yield { type: "tool_completed", data: result };
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: JSON.stringify(
          result.ok
            ? (result.output ?? null)
            : { errorType: result.errorType, errorMessage: result.errorMessage }
        )
      });
    }
  }

  /** 为模型未生成可靠后续回答时，基于最近一次工具结果产生确定性摘要。 */
  private getToolResultFallbackAnswer(messages: ChatMessage[], assistantContent: string): string {
    const result = this.getLatestToolResult(messages);
    if (!result) return "";
    const content = assistantContent.trim();
    if (
      content &&
      (!("url" in result) ||
        !/正在(查询|获取|调用)|请稍等|稍等片刻|当前时间|现在时间|now checking|please wait/iu.test(
          content
        ))
    )
      return "";
    if ("errorType" in result || "errorMessage" in result)
      return `工具调用失败：${String(result.errorMessage || result.errorType || "未知错误")}`;
    if (typeof result.localTime === "string")
      return `当前时间是 ${result.localTime}（${typeof result.timezone === "string" ? result.timezone : DEFAULT_TIMEZONE}）。`;
    if (typeof result.result === "number") return `计算结果是 ${result.result}。`;
    if (typeof result.url === "string" && typeof result.status === "number") {
      const body =
        result.body == null
          ? ""
          : String(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
      const preview = body.replace(/\s+/gu, " ").trim().slice(0, 300);
      return `HTTP 请求完成：${typeof result.method === "string" ? result.method : "GET"} ${result.url} 返回 ${result.status}。${preview ? `响应：${preview}` : ""}`;
    }
    return `工具执行完成：${JSON.stringify(result)}`;
  }

  /** 读取消息队列中最近一次工具结果，解析失败时不做回退回答。 */
  private getLatestToolResult(messages: ChatMessage[]): Record<string, unknown> | null {
    const message = [...messages]
      .reverse()
      .find((item) => item.role === "tool" && typeof item.content === "string");
    return message && typeof message.content === "string"
      ? this.parseJsonObject(message.content)
      : null;
  }

  /** 递归收敛工具参数为可持久化、可校验的 JSON 值。 */
  private toToolInput(value: Record<string, unknown>): Record<string, ToolJsonValue> {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.toToolJsonValue(item)])
    );
  }

  /** 将未知值转换为工具协议允许的 JSON 值。 */
  private toToolJsonValue(value: unknown): ToolJsonValue {
    if (value === null || ["string", "number", "boolean"].includes(typeof value))
      return value as ToolJsonValue;
    if (Array.isArray(value)) return value.map((item) => this.toToolJsonValue(item));
    if (value && typeof value === "object")
      return this.toToolInput(value as Record<string, unknown>);
    return null;
  }

  /** 生成一次调用内唯一的工具调用 ID，供事件、日志和模型消息关联。 */
  private createToolCallId(toolName: string): string {
    return `call_${toolName}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  /** Runtime 依赖缺失属于部署错误，在实际执行前给出明确诊断。 */
  private requireAgentsService(): AgentsService {
    if (!this.agentsService) throw new Error("Agent Runtime 缺少 AgentsService");
    return this.agentsService;
  }

  /** Runtime 依赖缺失属于部署错误，在实际模型调用前给出明确诊断。 */
  private requireModelProvidersService(): ModelProvidersService {
    if (!this.modelProvidersService) throw new Error("Agent Runtime 缺少 ModelProvidersService");
    return this.modelProvidersService;
  }

  /** Runtime 依赖缺失属于部署错误，在工具解析和执行前给出明确诊断。 */
  private requireToolsService(): ToolsService {
    if (!this.toolsService) throw new Error("Agent Runtime 缺少 ToolsService");
    return this.toolsService;
  }

  /** Workflow 模式必须由统一 Runtime 执行，缺少依赖说明模块装配不完整。 */
  private requireWorkflowRuntimeService(): WorkflowRuntimeService {
    if (!this.workflowRuntimeService) {
      throw new Error("Agent Runtime 缺少 WorkflowRuntimeService");
    }
    return this.workflowRuntimeService;
  }

  /** Workflow Tool 需要独立 Run 编排器，不能直接绕过 Trace 调用底层 Runtime。 */
  private requireWorkflowToolRunsService(): WorkflowToolRunsService {
    if (!this.workflowToolRunsService) {
      throw new Error("Agent Runtime 缺少 WorkflowToolRunsService");
    }
    return this.workflowToolRunsService;
  }

  /** Runtime 依赖缺失属于部署错误，在知识检索前给出明确诊断。 */
  private requireRetrievalService(): RetrievalService {
    if (!this.retrievalService) throw new Error("Agent Runtime 缺少 RetrievalService");
    return this.retrievalService;
  }

  /** Prompt Builder 是无状态组件，测试未注入时使用本地实例。 */
  private requirePromptBuilder(): AgentPromptBuilder {
    return this.promptBuilder ?? new AgentPromptBuilder();
  }

  private requireSkillPromptRenderer(): SkillPromptRenderer {
    return this.skillPromptRenderer ?? new SkillPromptRenderer();
  }

  /** Trace 写入失败统一进入运维日志，避免每个调用点重复处理。 */
  private logTraceFailure(message: string, error: unknown): void {
    this.logger.error(message, error instanceof Error ? error.stack : String(error));
  }
}
