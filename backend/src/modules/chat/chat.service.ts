import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import { AgentChatSessionMode, AgentRunSource, ChatTurnStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentRuntimeEvent, RuntimeCompletion } from "../agent_runtime/dto/runtime-event.dto";
import { AgentContentPart, textContentParts } from "../agent_runtime/dto/content-part.dto";
import { AgentRuntimeService } from "../agent_runtime/agent-runtime.service";
import { MAX_TRANSPORT_HISTORY_BYTES, sanitizeHistory } from "../agent_runtime/history-policy";
import { AgentPromptBuilder } from "../agent_runtime/prompt-builder";
import { AgentsService } from "../agents/agents.service";
import { AgentRunsService } from "../agent_runs/agent-runs.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { ChatMessage } from "../model-providers/dto/llm.dto";
import { RetrievalService } from "../retrieval/retrieval.service";
import { ToolsService } from "../tools/tools.service";
import { LogsService } from "../logs/logs.service";
import {
  ChatFileAttachmentDto,
  ChatImageAttachmentDto,
  ChatCompletionDto,
  ChatCompletionResult,
  ChatMessageDto,
  ChatSessionResponse,
  ChatStreamEvent
} from "./dto/chat.dto";
import {
  ChatMessageMetadata,
  ChatFeedbackQueryDto,
  ChatMessageFeedbackDto,
  ChatMessageQueryDto,
  ChatSessionListQueryDto,
  CreateChatSessionDto,
  UpdateChatSessionDto
} from "./dto/chat-session.dto";
import { ChatSessionsService } from "./chat-sessions.service";

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;
const MAX_FILE_COUNT = 4;
const MAX_FILE_CONTENT_LENGTH = 200_000;

/**
 * 一次 Chat 调用在模块间传递的请求上下文。
 * 字段保持可序列化，便于后续将运行链路拆为远程调用并继续透传 requestId。
 */
export type ChatRequestContext = {
  /** 贯穿 Chat、Runtime、模型调用和日志的请求追踪 ID。 */
  requestId?: string;
  /** 运行来源，用于区分工作台、API 和公开访问。 */
  source?: AgentRunSource;
  /** 外部访问模块管理的会话 ID。 */
  externalConversationId?: string;
  /** 工作台当前登录用户 ID；匿名外部访问可以为空。 */
  userId?: string;
  /**
   * 外部访问模块会自行保存 ExternalConversation。这里仅接收已校验的历史，避免 Chat
   * 直接依赖 external_access 表，同时也不会误把外部访客写入工作台 ChatSession。
   */
  externalHistory?: ChatMessageDto[];
  /** 是否禁止写入内部 ChatSession，外部会话必须开启。 */
  skipInternalSessionPersistence?: boolean;
};

/** 解析持久会话时只需要的最小 Agent 配置。 */
type PersistentSessionAgent = {
  /** Agent ID。 */
  agentId: string;
  /** Agent 当前会话模式。 */
  chatSessionMode: AgentChatSessionMode;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly modelProvidersService: ModelProvidersService,
    private readonly toolsService: ToolsService,
    private readonly retrievalService: RetrievalService,
    private readonly chatSessionsService?: ChatSessionsService,
    @Optional() private readonly agentRunsService?: AgentRunsService,
    @Optional() private readonly promptBuilder?: AgentPromptBuilder,
    @Optional() private readonly agentRuntimeService?: AgentRuntimeService,
    @Optional() private readonly logsService?: LogsService
  ) {}

  /**
   * 获取指定保留型 Agent 的会话列表。
   * 单次 Agent 不应该出现会话管理入口，因此在后端再次阻止该类请求。
   */
  async listSessions(query: ChatSessionListQueryDto, context: ChatRequestContext) {
    const agentId = this.requireNonEmptyString(query.agentId, "agentId");
    const agent = await this.requirePersistentAgent(agentId);

    return this.requireChatSessionsService().listSessions(
      { agentId: agent.agentId, userId: this.requireSessionUserId(context) },
      query
    );
  }

  /**
   * 兼容旧聊天页的单会话读取接口。
   * 新页面应改用会话列表、创建会话和消息分页接口；保留此入口可以避免前后端分步发布时
   * 保留型 Agent 立即不可用。
   */
  async getSession(agentId: string, context: ChatRequestContext): Promise<ChatSessionResponse> {
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);

    if (agent.chatSessionMode !== AgentChatSessionMode.PERSISTENT) {
      return { mode: "EPHEMERAL", sessionId: null, messages: [] };
    }

    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const response = await sessions.listSessions(
      { agentId: agent.agentId, userId },
      { pageSize: "1" }
    );
    const session =
      response.list[0] ?? (await sessions.createSession({ agentId: agent.agentId, userId }));
    const messages = await sessions.getMessagePage(
      session.id,
      { agentId: agent.agentId, userId },
      { pageSize: "100" }
    );

    return {
      mode: "PERSISTENT",
      sessionId: session.id,
      messages: messages.list
    };
  }

  /** 创建独立持久会话，并校验 Agent 确实启用了保留型会话模式。 */
  async createSession(payload: CreateChatSessionDto, context: ChatRequestContext) {
    const agentId = this.requireNonEmptyString(payload.agentId, "agentId");
    const agent = await this.requirePersistentAgent(agentId);

    return this.requireChatSessionsService().createSession({
      agentId: agent.agentId,
      userId: this.requireSessionUserId(context)
    });
  }

  /** 分页读取归属于当前用户的会话消息。 */
  async getSessionMessages(
    sessionId: string,
    query: ChatMessageQueryDto,
    context: ChatRequestContext
  ) {
    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const session = await sessions.getOwnedSession(sessionId, userId);
    await this.requirePersistentAgent(session.agentId);

    return sessions.getMessagePage(sessionId, { agentId: session.agentId, userId }, query);
  }

  async upsertMessageFeedback(
    messageId: string,
    payload: ChatMessageFeedbackDto,
    context: ChatRequestContext
  ) {
    return this.requireChatSessionsService().upsertMessageFeedback(
      messageId,
      this.requireSessionUserId(context),
      payload
    );
  }

  async deleteMessageFeedback(messageId: string, context: ChatRequestContext): Promise<void> {
    return this.requireChatSessionsService().deleteMessageFeedback(
      messageId,
      this.requireSessionUserId(context)
    );
  }

  async listFeedback(query: ChatFeedbackQueryDto) {
    return this.requireChatSessionsService().listFeedback(query);
  }

  /** 更新会话标题；归属和标题合法性由会话 Service 统一保证。 */
  async updateSession(
    sessionId: string,
    payload: UpdateChatSessionDto,
    context: ChatRequestContext
  ) {
    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const session = await sessions.getOwnedSession(sessionId, userId);
    await this.requirePersistentAgent(session.agentId);

    return sessions.updateSession(sessionId, { agentId: session.agentId, userId }, payload);
  }

  /** 归档会话但保留消息记录。 */
  async archiveSession(sessionId: string, context: ChatRequestContext) {
    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const session = await sessions.getOwnedSession(sessionId, userId);
    await this.requirePersistentAgent(session.agentId);

    return sessions.archiveSession(sessionId, { agentId: session.agentId, userId });
  }

  /** 恢复归档会话，使其重新允许追加消息。 */
  async restoreSession(sessionId: string, context: ChatRequestContext) {
    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const session = await sessions.getOwnedSession(sessionId, userId);
    await this.requirePersistentAgent(session.agentId);

    return sessions.restoreSession(sessionId, { agentId: session.agentId, userId });
  }

  /**
   * 永久删除只允许针对已归档会话执行。
   *
   * 活跃会话仍应先归档，给用户一次恢复机会；删除后由外键级联清理消息，无法恢复。
   */
  async deleteSession(sessionId: string, context: ChatRequestContext): Promise<void> {
    const userId = this.requireSessionUserId(context);
    const sessions = this.requireChatSessionsService();
    const session = await sessions.getOwnedSession(sessionId, userId);
    await this.requirePersistentAgent(session.agentId);

    return sessions.deleteSession(sessionId, { agentId: session.agentId, userId });
  }

  /**
   * 执行非流式对话，并把调用用户写入工具日志。
   *
   * 用户身份由 Controller 的 Guard 提供；保留可选参数是为了兼容现有服务层单测，
   * 但生产 HTTP 路径始终会传入 userId。
   */
  async createCompletion(
    payload: ChatCompletionDto,
    context?: ChatRequestContext
  ): Promise<ChatCompletionResult> {
    let completion: RuntimeCompletion | undefined;

    for await (const event of this.streamRuntimeEvents(payload, undefined, context)) {
      if (event.type === "run_completed") {
        completion = event.data;
      }

      if (event.type === "run_failed") {
        throw new AppError(
          ErrorCodes.common.internal,
          event.data.error.publicMessage,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      if (event.type === "run_canceled") {
        throw new AppError(ErrorCodes.common.badRequest, "Agent 调用已取消");
      }
    }

    if (!completion) {
      throw new AppError(ErrorCodes.common.internal, "Agent 未返回完整结果");
    }

    return {
      agentId: completion.agentId,
      modelConfigId: completion.modelConfigId,
      modelName: completion.modelName,
      providerName: completion.providerName,
      content: completion.content,
      contentParts: completion.contentParts
    };
  }

  /**
   * 执行流式对话，并将用户身份沿工具调用链传递到审计日志。
   *
   * AbortSignal 仍保持第二个参数，避免中断机制与身份上下文耦合；Controller 在第三个参数
   * 传入已验证用户，保证 SSE 与非流式接口记录一致的 userId。
   */
  async *streamCompletion(
    payload: ChatCompletionDto,
    signal?: AbortSignal,
    context?: ChatRequestContext
  ): AsyncIterable<ChatStreamEvent> {
    for await (const event of this.streamRuntimeEvents(payload, signal, context)) {
      yield this.toChatStreamEvent(event);
    }
  }

  /** 将现有 Chat 编排转换为协议无关 Runtime 事件，供流式和非流式入口共同消费。 */
  async *streamRuntimeEvents(
    payload: ChatCompletionDto,
    signal?: AbortSignal,
    context?: ChatRequestContext
  ): AsyncIterable<AgentRuntimeEvent> {
    const agentId = this.requireNonEmptyString(payload.agentId, "agentId");
    const images = this.normalizeImages(payload.images);
    const files = this.normalizeFiles(payload.files);
    const message = this.normalizeUserMessage(payload.message, images, files);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const sessionId = context?.skipInternalSessionPersistence
      ? null
      : await this.resolvePersistentSessionId(agent, payload.sessionId, context);
    const turn = sessionId
      ? await this.requireChatSessionsService().startTurn(
          sessionId,
          this.normalizeClientMessageId(payload.clientMessageId),
          message
        )
      : null;
    if (turn && !turn.created) {
      const snapshot = await this.requireChatSessionsService().getTurnSnapshot(turn.turnId);
      const assistant = snapshot?.messages.find((item) => item.id === snapshot.assistantMessageId);
      if (snapshot?.status === ChatTurnStatus.COMPLETED && assistant) {
        const storedMetadata =
          assistant.metadata &&
          typeof assistant.metadata === "object" &&
          !Array.isArray(assistant.metadata)
            ? (assistant.metadata as Record<string, unknown>)
            : {};
        yield {
          type: "run_completed",
          data: {
            runId: snapshot.runId ?? undefined,
            agentId,
            modelConfigId: String(storedMetadata.modelConfigId ?? agent.modelConfigId),
            modelName: String(storedMetadata.modelName ?? agent.modelName),
            providerName: String(storedMetadata.providerName ?? agent.providerType),
            sessionId,
            content: assistant.content,
            contentParts: Array.isArray(assistant.contentParts)
              ? (assistant.contentParts as unknown as AgentContentPart[])
              : textContentParts(assistant.content),
            messageId: assistant.id,
            turnId: turn.turnId,
            sequence: turn.sequence.toString()
          } as RuntimeCompletion & { turnId: string; sequence: string }
        };
        return;
      }
      throw new AppError(
        ErrorCodes.common.conflict,
        "chat turn is already generating",
        HttpStatus.CONFLICT
      );
    }
    const rawHistory = context?.externalHistory
      ? context.externalHistory
      : turn
        ? await this.requireChatSessionsService().buildTurnModelHistory(turn, agent.historyTurns)
        : payload.history;
    // 无论历史来自客户端、外部会话还是数据库，都统一经过 Chat 权威策略后才进入 Runtime。
    const history = this.normalizeHistory(rawHistory, agent.historyTurns);
    const requestId = this.resolveRequestId(context);
    const startedAt = Date.now();
    const metadata: ChatMessageMetadata = {
      requestId,
      retrievalEvents: [],
      toolEvents: []
    };
    let activeRetrievalKnowledgeBaseIds: string[] = [];
    let firstTokenRecorded = false;

    try {
      for await (const event of this.requireAgentRuntimeService().runAgent({
        requestId,
        source: context?.source ?? AgentRunSource.INTERNAL_CHAT,
        agentId,
        userId: context?.userId,
        sessionId: sessionId ?? undefined,
        externalConversationId: context?.externalConversationId,
        message: { text: message, images, files },
        history: history.flatMap((item) =>
          (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
            ? [{ role: item.role, content: item.content }]
            : []
        ),
        // 公开访问和 Service API 没有可信的交互审批主体，必须稳定走非交互拒绝策略。
        allowInteractiveToolApproval:
          (context?.source ?? AgentRunSource.INTERNAL_CHAT) === AgentRunSource.INTERNAL_CHAT &&
          Boolean(context?.userId),
        signal
      })) {
        if (event.type === "run_started") {
          metadata.runId = event.data.runId;
          metadata.modelConfigId = event.data.modelConfigId;
          metadata.modelName = event.data.modelName;
          metadata.providerName = event.data.providerName;
          if (turn) {
            await this.requireChatSessionsService().bindTurnRun(turn.turnId, event.data.runId);
          }
        }

        if (turn) {
          const turnData = event.data as unknown as Record<string, unknown>;
          turnData.turnId = turn.turnId;
          turnData.sequence = turn.sequence.toString();
          turnData.messageId = turn.assistantMessageId;
        }

        if (event.type === "tool_search_completed") {
          metadata.toolSearch = event.data;
        }

        if (event.type === "retrieval_started") {
          activeRetrievalKnowledgeBaseIds = this.readStringArray(event.data.knowledgeBaseIds);
        }

        if (event.type === "retrieval_completed") {
          metadata.retrievalEvents?.push({
            knowledgeBaseIds: activeRetrievalKnowledgeBaseIds,
            status: "success",
            sources: this.readRecordArray(event.data.sources),
            elapsedMs: this.readOptionalNumber(event.data.elapsedMs)
          });
        }

        if (event.type === "tool_started") {
          metadata.toolEvents?.push({
            id:
              this.readString(event.data.id) || this.readString(event.data.toolCallId) || "unknown",
            name: this.readString(event.data.name) || "unknown_tool",
            arguments: this.readOptionalRecord(event.data.arguments),
            status: "success"
          });
        }

        if (event.type === "tool_completed") {
          const toolId = this.readString(event.data.toolId) || this.readString(event.data.id);
          const toolEvents = metadata.toolEvents ?? [];
          let toolIndex = -1;
          for (let index = toolEvents.length - 1; index >= 0; index -= 1) {
            if (toolEvents[index]?.name === toolId) {
              toolIndex = index;
              break;
            }
          }
          const toolEvent = toolIndex >= 0 ? toolEvents[toolIndex] : undefined;

          if (toolEvent) {
            const ok = event.data.ok === true;
            toolEvent.status = ok ? "success" : "error";
            toolEvent.output = event.data.output;
            toolEvent.errorType = this.readString(event.data.errorType) || undefined;
            toolEvent.errorMessage = this.readString(event.data.errorMessage) || undefined;
            toolEvent.elapsedMs = this.readOptionalNumber(event.data.elapsedMs);
          }
        }

        if (event.type === "token" && !firstTokenRecorded) {
          firstTokenRecorded = true;
          metadata.firstTokenMs = Date.now() - startedAt;
        }

        if (event.type === "run_completed" && turn) {
          metadata.runId = event.data.runId ?? metadata.runId;
          metadata.usage = event.data.usage;
          metadata.elapsedMs = Date.now() - startedAt;
          const persistedMessageId = await this.requireChatSessionsService().completeTurn(
            turn,
            event.data.content,
            metadata,
            event.data.contentParts
          );
          if (persistedMessageId) {
            event.data.messageId = persistedMessageId;
          }
        }
        if (event.type === "run_completed") {
          metadata.runId = event.data.runId ?? metadata.runId;
          metadata.usage = event.data.usage;
          metadata.elapsedMs = Date.now() - startedAt;
          await this.saveCompletedRagTrace({
            requestId,
            sessionId: sessionId ?? undefined,
            messageId: event.data.messageId,
            userId: context?.userId,
            agent,
            query: message,
            answer: event.data.content,
            metadata,
            status: "completed"
          });
        }
        if (event.type === "run_failed" || event.type === "run_canceled") {
          metadata.runId = event.data.runId ?? metadata.runId;
          metadata.elapsedMs = Date.now() - startedAt;
          if (turn) {
            await this.requireChatSessionsService().failTurn(
              turn.turnId,
              event.type === "run_failed" ? ChatTurnStatus.FAILED : ChatTurnStatus.CANCELED,
              event.type === "run_failed" ? event.data.error.type : "canceled",
              event.type === "run_failed" ? event.data.error.message : undefined
            );
          }
          await this.saveCompletedRagTrace({
            requestId,
            sessionId: sessionId ?? undefined,
            userId: context?.userId,
            agent,
            query: message,
            answer: "",
            metadata,
            status: event.type === "run_failed" ? "failed" : "canceled",
            error:
              event.type === "run_failed" ? { type: event.data.error.type } : { type: "canceled" }
          });
        }
        yield event;
      }
    } catch (error) {
      if (turn) {
        const canceled = signal?.aborted === true;
        await this.requireChatSessionsService().failTurn(
          turn.turnId,
          canceled ? ChatTurnStatus.CANCELED : ChatTurnStatus.FAILED,
          canceled ? "canceled" : "stream_interrupted",
          error instanceof Error ? error.message : undefined
        );
      }
      throw error;
    }
  }

  private normalizeClientMessageId(value: string | undefined): string {
    if (value === undefined) return randomUUID();
    const normalized = value.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ) {
      throw new AppError(ErrorCodes.common.badRequest, "clientMessageId must be a UUID");
    }
    return normalized;
  }

  /** Trace 是观测数据，任何写入错误都不能破坏已经成功生成的在线回答。 */
  private async saveCompletedRagTrace(input: {
    requestId: string;
    sessionId?: string;
    messageId?: string;
    userId?: string;
    agent: Awaited<ReturnType<AgentsService["getAgentRuntimeConfig"]>>;
    query: string;
    answer: string;
    metadata: ChatMessageMetadata;
    status: "completed" | "failed" | "canceled";
    error?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.logsService) return;
    const retrievalEvents = input.metadata.retrievalEvents ?? [];
    const selectedChunks = retrievalEvents.flatMap((event) => event.sources);
    try {
      await this.logsService.createRagTrace({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        userId: input.userId,
        agentId: input.agent.agentId,
        agentConfigSnapshot: {
          id: input.agent.agentId,
          name: input.agent.name,
          knowledgeBaseIds: input.agent.knowledgeBaseIds,
          toolIds: input.agent.toolIds,
          temperature: input.agent.temperature,
          maxTokens: input.agent.maxTokens,
          historyTurns: input.agent.historyTurns,
          thinkingMode: input.agent.thinkingMode
        },
        query: input.query,
        retrievalConfigSnapshot: {
          strategy: "hybrid_rrf",
          knowledgeBaseIds: input.agent.knowledgeBaseIds
        },
        // 当前 Retrieval 对外只暴露经融合和阈值筛选后的受控候选；首期候选与入模集合一致。
        candidateChunks: selectedChunks,
        selectedChunks,
        promptVersion: "agent-runtime-v1",
        modelConfigSnapshot: {
          modelConfigId: input.metadata.modelConfigId,
          modelName: input.metadata.modelName,
          providerName: input.metadata.providerName,
          providerId: input.agent.providerId,
          providerType: input.agent.providerType,
          timeoutSeconds: input.agent.timeoutSeconds
        },
        answer: input.answer,
        citations: selectedChunks,
        retrievalElapsedMs:
          retrievalEvents.length > 0
            ? retrievalEvents.reduce((total, event) => total + (event.elapsedMs ?? 0), 0)
            : undefined,
        firstTokenElapsedMs: input.metadata.firstTokenMs,
        totalElapsedMs: input.metadata.elapsedMs,
        tokenUsage: input.metadata.usage,
        status: input.status,
        error: input.error
      });
    } catch {
      // 日志模块应自行观测数据库错误；Chat 不能因 Trace 失败改写生成终态。
    }
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private readRecordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
      : [];
  }

  private readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  /** 将 Runtime 事件映射回既有 SSE 协议，避免阶段 C 要求前端同步升级。 */
  private toChatStreamEvent(event: AgentRuntimeEvent): ChatStreamEvent {
    switch (event.type) {
      case "run_started":
        return { type: "message_start", data: event.data };
      case "tool_search_started":
        return { type: "tool_search_start", data: event.data };
      case "tool_search_completed":
        return { type: "tool_search_result", data: event.data };
      case "retrieval_started":
        return { type: "retrieval_start", data: event.data };
      case "retrieval_completed":
        return { type: "retrieval_result", data: event.data };
      case "token":
        return { type: "token", data: event.data };
      case "content_part":
        return { type: "content_part", data: event.data };
      case "tool_started":
        return { type: "tool_call", data: event.data };
      case "tool_approval_required":
        return { type: "tool_approval_required", data: event.data };
      case "tool_approval_resolved":
        return { type: "tool_approval_resolved", data: event.data };
      case "tool_completed":
        return { type: "tool_result", data: event.data };
      case "run_completed":
        return {
          type: "message_end",
          data: {
            ...(event.data as unknown as Record<string, unknown>),
            runId: event.data.runId,
            messageId: event.data.messageId,
            content: event.data.content,
            contentParts: event.data.contentParts,
            usage: event.data.usage,
            modelConfigId: event.data.modelConfigId,
            modelName: event.data.modelName,
            providerName: event.data.providerName
          }
        };
      case "run_failed":
        return {
          type: "error",
          data: {
            ...(event.data as unknown as Record<string, unknown>),
            runId: event.data.runId,
            errorType: event.data.error.type,
            message: event.data.error.publicMessage
          }
        };
      case "run_canceled":
        return {
          type: "error",
          data: {
            ...(event.data as unknown as Record<string, unknown>),
            runId: event.data.runId,
            errorType: "canceled",
            message: "Agent 调用已取消"
          }
        };
    }
  }

  /** HTTP 入口优先沿用 Middleware request ID，内部调用和旧单测才回退生成 UUID。 */
  private resolveRequestId(context?: ChatRequestContext): string {
    return this.requireAgentRuntimeService().resolveRequestId(context?.requestId);
  }

  /** 获取 Runtime 服务；旧单测仍按原构造参数注入依赖时创建兼容实例。 */
  private requireAgentRuntimeService(): AgentRuntimeService {
    return (
      this.agentRuntimeService ??
      new AgentRuntimeService(
        this.agentRunsService,
        this.agentsService,
        this.modelProvidersService,
        this.toolsService,
        this.retrievalService,
        this.promptBuilder
      )
    );
  }

  /**
   * 保留型 Agent 的流式调用必须明确指定 sessionId。
   *
   * 旧版自动 upsert 会让“新建对话”仍复用历史上下文；现在由前端先创建会话，再把 ID
   * 传入 SSE，使用户意图和数据归属都可验证。
   */
  private async resolvePersistentSessionId(
    agent: PersistentSessionAgent,
    sessionId: string | undefined,
    context?: ChatRequestContext
  ): Promise<string | null> {
    if (agent.chatSessionMode !== AgentChatSessionMode.PERSISTENT) {
      return null;
    }

    const id = this.requireNonEmptyString(sessionId, "sessionId");
    await this.requireChatSessionsService().requireActiveSession(id, {
      agentId: agent.agentId,
      userId: this.requireSessionUserId(context)
    });

    return id;
  }

  /** 确保传入 Agent 使用持久会话模式，阻止临时 Agent 进入会话管理流程。 */
  private async requirePersistentAgent(agentId: string) {
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);

    if (agent.chatSessionMode !== AgentChatSessionMode.PERSISTENT) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "agent uses ephemeral chat sessions",
        HttpStatus.CONFLICT
      );
    }

    return agent;
  }

  /** 获取持久会话所需用户 ID；外部匿名访问不得写入内部 ChatSession。 */
  private requireSessionUserId(context?: ChatRequestContext): string {
    if (!context?.userId) {
      throw new AppError(
        ErrorCodes.common.unauthorized,
        "persistent chat session requires an authenticated user",
        HttpStatus.UNAUTHORIZED
      );
    }

    return context.userId;
  }

  /** 在可选依赖缺失时返回明确配置错误，兼容模块拆分期间的旧单测构造方式。 */
  private requireChatSessionsService(): ChatSessionsService {
    if (!this.chatSessionsService) {
      // 旧单测只覆盖单次模式，不需要构造会话服务；真实 Nest 容器会始终注入该 Provider。
      throw new AppError(ErrorCodes.common.internal, "chat session storage is not configured");
    }

    return this.chatSessionsService;
  }

  /** 使用 Agent 权威配置清洗历史，客户端只能缩小而不能放大模型上下文。 */
  private normalizeHistory(history: ChatMessageDto[] | undefined, maxTurns: number): ChatMessage[] {
    return sanitizeHistory(history, {
      maxTurns,
      maxTotalBytes: MAX_TRANSPORT_HISTORY_BYTES,
      violationSource: "client"
    }).messages;
  }

  /** 校验必填字符串并去除首尾空白。 */
  private requireNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `${fieldName} is required`,
        HttpStatus.BAD_REQUEST
      );
    }

    return value.trim();
  }

  /** 统一校验用户正文与附件，确保至少包含一种有效输入。 */
  private normalizeUserMessage(
    value: unknown,
    images: ChatImageAttachmentDto[],
    files: ChatFileAttachmentDto[]
  ): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (images.length > 0) {
      return "请分析这张图片。";
    }

    if (files.length > 0) {
      return "请阅读并分析这些文件内容。";
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      "message or images is required",
      HttpStatus.BAD_REQUEST
    );
  }

  /** 校验图片数量、格式和 Data URL 体积，避免超大载荷进入模型网关。 */
  private normalizeImages(value: unknown): ChatImageAttachmentDto[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.common.badRequest, "images must be an array");
    }

    if (value.length > MAX_IMAGE_COUNT) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `images cannot exceed ${MAX_IMAGE_COUNT} items`
      );
    }

    return value.map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const mimeType = typeof item?.mimeType === "string" ? item.mimeType.trim() : "";
      const dataUrl = typeof item?.dataUrl === "string" ? item.dataUrl.trim() : "";

      if (
        !name ||
        !mimeType.startsWith("image/") ||
        !dataUrl.startsWith(`data:${mimeType};base64,`)
      ) {
        throw new AppError(ErrorCodes.common.badRequest, "images is invalid");
      }

      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        throw new AppError(ErrorCodes.common.badRequest, "image is too large");
      }

      return {
        name,
        mimeType,
        dataUrl
      };
    });
  }

  /** 校验文本附件数量与内容大小，并生成稳定的附件 DTO。 */
  private normalizeFiles(value: unknown): ChatFileAttachmentDto[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new AppError(ErrorCodes.common.badRequest, "files must be an array");
    }

    if (value.length > MAX_FILE_COUNT) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `files cannot exceed ${MAX_FILE_COUNT} items`
      );
    }

    return value.map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const mimeType = typeof item?.mimeType === "string" ? item.mimeType.trim() : "";
      const size = Number(item?.size);
      const content = typeof item?.content === "string" ? item.content : "";

      if (!name || !Number.isFinite(size) || size < 0 || content.trim().length === 0) {
        throw new AppError(ErrorCodes.common.badRequest, "files is invalid");
      }

      if (content.length > MAX_FILE_CONTENT_LENGTH) {
        throw new AppError(ErrorCodes.common.badRequest, "file content is too large");
      }

      return {
        name,
        mimeType,
        size,
        content
      };
    });
  }

  /** 将正文、图片和文件上下文转换为模型供应商使用的统一消息。 */
  private buildUserMessage(
    content: string,
    images: ChatImageAttachmentDto[],
    files: ChatFileAttachmentDto[]
  ): ChatMessage {
    const textContent = this.appendFileContext(content, files);

    if (images.length === 0) {
      return {
        role: "user",
        content: textContent
      };
    }

    return {
      role: "user",
      content: [
        {
          type: "text",
          text: textContent
        },
        ...images.map((image) => ({
          type: "image" as const,
          mimeType: image.mimeType,
          dataUrl: image.dataUrl
        }))
      ]
    };
  }

  /** 将文本附件包裹为有边界的上下文，降低文件内容与用户指令混淆的风险。 */
  private appendFileContext(content: string, files: ChatFileAttachmentDto[]): string {
    if (files.length === 0) {
      return content;
    }

    const fileContext = files
      .map((file, index) => {
        return [
          `文件 ${index + 1}: ${file.name}`,
          `MIME: ${file.mimeType || "text/plain"}`,
          "内容:",
          "```",
          file.content,
          "```"
        ].join("\n");
      })
      .join("\n\n");

    return `${content}\n\n以下是用户上传的文件内容，请作为上下文参考：\n\n${fileContext}`;
  }

  /** 在调用模型前快速拒绝明显不支持视觉输入的模型配置。 */
  private ensureImageInputSupported(modelName: string, images: ChatImageAttachmentDto[]): void {
    if (images.length === 0) {
      return;
    }

    if (this.isLikelyVisionModel(modelName)) {
      return;
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      `当前模型 ${modelName} 不支持图片输入，请切换到视觉模型，例如 qwen-vl-max、qwen2.5-vl 或其他支持 image input 的模型。`,
      HttpStatus.BAD_REQUEST
    );
  }

  /** 根据常见模型命名识别视觉能力；这是配置保护，不替代供应商能力校验。 */
  private isLikelyVisionModel(modelName: string): boolean {
    const normalized = modelName.toLowerCase();
    const visionModelKeywords = [
      "vl",
      "vision",
      "omni",
      "qvq",
      "gpt-4o",
      "gpt-4.1",
      "gemini",
      "claude-3",
      "claude-4"
    ];

    return visionModelKeywords.some((keyword) => normalized.includes(keyword));
  }
}
