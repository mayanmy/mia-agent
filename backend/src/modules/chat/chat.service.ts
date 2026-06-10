import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "../agents/agents.service";
import { ModelProvidersService } from "../model-providers/model-providers.service";
import { ChatMessage, LLMToolCall, LLMToolDefinition } from "../model-providers/dto/llm.dto";
import { ToolCallLogRecord, ToolDefinition, ToolJsonValue } from "../tools/dto/tool.dto";
import { ToolsService } from "../tools/tools.service";
import {
  ChatFileAttachmentDto,
  ChatImageAttachmentDto,
  ChatCompletionDto,
  ChatCompletionResult,
  ChatMessageDto,
  ChatStreamEvent
} from "./dto/chat.dto";

const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;
const MAX_FILE_COUNT = 4;
const MAX_FILE_CONTENT_LENGTH = 200_000;
const MAX_TOOL_ROUNDS = 3;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

@Injectable()
export class ChatService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly modelProvidersService: ModelProvidersService,
    private readonly toolsService: ToolsService
  ) {}

  async createCompletion(payload: ChatCompletionDto): Promise<ChatCompletionResult> {
    const agentId = this.requireNonEmptyString(payload.agentId, "agentId");
    const images = this.normalizeImages(payload.images);
    const files = this.normalizeFiles(payload.files);
    const message = this.normalizeUserMessage(payload.message, images, files);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const requestId = randomUUID();
    this.ensureImageInputSupported(agent.modelName, images);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);
    const toolDefinitions = this.toolsService.getToolDefinitions(agent.toolIds);
    const llmTools = this.toLLMToolDefinitions(toolDefinitions);
    await this.recordToolAvailability({
      requestId,
      agentId: agent.agentId,
      toolIds: agent.toolIds,
      toolDefinitions
    });
    const messages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(agent.systemPrompt, llmTools) },
      ...history,
      this.buildUserMessage(message, images, files)
    ];

    const response = await this.createCompletionWithTools({
      modelConfigId: agent.modelConfigId,
      messages,
      tools: llmTools,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      timeoutSeconds: agent.timeoutSeconds,
      requestId,
      agentId: agent.agentId
    });

    return {
      agentId: agent.agentId,
      modelConfigId: agent.modelConfigId,
      modelName: response.model || agent.modelName,
      providerName: agent.providerType,
      content: response.content
    };
  }

  async *streamCompletion(
    payload: ChatCompletionDto,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamEvent> {
    const agentId = this.requireNonEmptyString(payload.agentId, "agentId");
    const images = this.normalizeImages(payload.images);
    const files = this.normalizeFiles(payload.files);
    const message = this.normalizeUserMessage(payload.message, images, files);
    const agent = await this.agentsService.getAgentRuntimeConfig(agentId);
    const requestId = randomUUID();
    this.ensureImageInputSupported(agent.modelName, images);
    const history = this.normalizeHistory(payload.history, agent.historyTurns);
    const toolDefinitions = this.toolsService.getToolDefinitions(agent.toolIds);
    const llmTools = this.toLLMToolDefinitions(toolDefinitions);
    await this.recordToolAvailability({
      requestId,
      agentId: agent.agentId,
      toolIds: agent.toolIds,
      toolDefinitions
    });
    const messages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(agent.systemPrompt, llmTools) },
      ...history,
      this.buildUserMessage(message, images, files)
    ];

    yield {
      type: "message_start",
      data: {
        agentId: agent.agentId,
        modelConfigId: agent.modelConfigId,
        modelName: agent.modelName,
        providerName: agent.providerType
      }
    };

    const inferredToolCall = this.inferToolCallFromUserMessage(message, llmTools);

    if (inferredToolCall) {
      yield* this.executeToolCalls([inferredToolCall], messages, {
        agentId: agent.agentId,
        requestId,
        signal,
        source: "inferred"
      });
    }

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      let toolCalls: LLMToolCall[] = [];
      let toolCallSource = "model_native";
      let assistantContent = "";
      const bufferedTokens: string[] = [];

      for await (const chunk of this.modelProvidersService.streamChatCompletion({
        modelConfigId: agent.modelConfigId,
        messages,
        tools: llmTools,
        toolChoice: llmTools.length > 0 ? "auto" : undefined,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        timeoutSeconds: agent.timeoutSeconds,
        signal
      })) {
        if (chunk.type === "token" && chunk.content) {
          assistantContent += chunk.content;

          if (llmTools.length > 0) {
            bufferedTokens.push(chunk.content);
          } else {
            yield {
              type: "token",
              data: {
                content: chunk.content
              }
            };
          }
        }

        if (chunk.type === "tool_call") {
          toolCalls.push(chunk.toolCall);
        }

        if (chunk.type === "error") {
          yield {
            type: "error",
            data: {
              message: chunk.errorMessage || "model stream failed"
            }
          };
          return;
        }
      }

      if (toolCalls.length === 0) {
        toolCalls = this.parseTextToolCalls(assistantContent, llmTools);
        if (toolCalls.length > 0) {
          toolCallSource = "text_json";
        }
      }

      if (toolCalls.length === 0) {
        if (llmTools.length > 0) {
          // Agent 有可用工具，但模型选择直接回答；这条日志用于排查“为什么没走工具”。
          await this.recordToolCallLog({
            requestId,
            agentId: agent.agentId,
            status: "skipped",
            source: "model_response",
            reason: "model_returned_no_tool_call",
            output: {
              assistantContentPreview: assistantContent.slice(0, 500)
            }
          });
        }

        const fallbackAnswer = this.getToolResultFallbackAnswer(messages, assistantContent);

        if (fallbackAnswer) {
          yield {
            type: "token",
            data: {
              content: fallbackAnswer
            }
          };
        } else {
          for (const token of bufferedTokens) {
            yield {
              type: "token",
              data: {
                content: token
              }
            };
          }
        }

        yield {
          type: "message_end",
          data: {}
        };
        return;
      }

      if (round >= MAX_TOOL_ROUNDS) {
        yield {
          type: "error",
          data: {
            message: "tool call rounds exceeded"
          }
        };
        return;
      }

      yield* this.executeToolCalls(toolCalls, messages, {
        agentId: agent.agentId,
        requestId,
        signal,
        source: toolCallSource,
        assistantContent
      });
    }

    yield {
      type: "error",
      data: {
        message: "tool call rounds exceeded"
      }
    };
  }

  private async createCompletionWithTools(request: {
    modelConfigId: string;
    messages: ChatMessage[];
    tools: LLMToolDefinition[];
    temperature: number;
    maxTokens: number | null;
    timeoutSeconds: number;
    requestId: string;
    agentId: string;
  }): Promise<{
    content: string;
    model: string;
    providerId: string;
    providerType: string;
  }> {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const latestUserMessage = [...request.messages]
        .reverse()
        .find((message) => message.role === "user");
      const inferredToolCall =
        round === 0 && typeof latestUserMessage?.content === "string"
          ? this.inferToolCallFromUserMessage(latestUserMessage.content, request.tools)
          : null;

      if (inferredToolCall) {
        await this.executeToolCallsForCompletion([inferredToolCall], request.messages, {
          requestId: request.requestId,
          agentId: request.agentId,
          source: "inferred"
        });
      }

      const response = await this.modelProvidersService.createChatCompletion({
        modelConfigId: request.modelConfigId,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.tools.length > 0 ? "auto" : undefined,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutSeconds: request.timeoutSeconds
      });

      const toolCalls = response.toolCalls?.length
        ? response.toolCalls
        : this.parseTextToolCalls(response.content, request.tools);
      const toolCallSource = response.toolCalls?.length ? "model_native" : "text_json";

      if (toolCalls.length === 0) {
        if (request.tools.length > 0) {
          await this.recordToolCallLog({
            requestId: request.requestId,
            agentId: request.agentId,
            status: "skipped",
            source: "model_response",
            reason: "model_returned_no_tool_call",
            output: {
              assistantContentPreview: response.content.slice(0, 500)
            }
          });
        }

        if (response.content.trim().length > 0) {
          return response;
        }

        return {
          ...response,
          content: this.formatLatestToolResultAnswer(request.messages)
        };
      }

      if (round >= MAX_TOOL_ROUNDS) {
        throw new AppError(
          ErrorCodes.common.badRequest,
          "tool call rounds exceeded",
          HttpStatus.BAD_REQUEST
        );
      }

      request.messages.push({
        role: "assistant",
        content: response.content,
        toolCalls
      });

      await this.executeToolCallsForCompletion(toolCalls, request.messages, {
        requestId: request.requestId,
        agentId: request.agentId,
        source: toolCallSource
      });
    }

    throw new AppError(
      ErrorCodes.common.badRequest,
      "tool call rounds exceeded",
      HttpStatus.BAD_REQUEST
    );
  }

  private toLLMToolDefinitions(tools: ToolDefinition[]): LLMToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.id,
      description: tool.description,
      parameters: tool.inputSchema
    }));
  }

  private async recordToolAvailability(request: {
    requestId: string;
    agentId: string;
    toolIds: string[];
    toolDefinitions: ToolDefinition[];
  }): Promise<void> {
    const enabledToolIds = request.toolDefinitions.map((tool) => tool.id);

    // 对话开始时记录工具可用性，后续排查时能知道 Agent 当时实际绑定并启用了哪些工具。
    if (request.toolIds.length === 0) {
      await this.recordToolCallLog({
        requestId: request.requestId,
        agentId: request.agentId,
        status: "skipped",
        source: "chat_start",
        reason: "agent_has_no_bound_tools",
        output: {
          boundToolIds: [],
          enabledToolIds
        }
      });
      return;
    }

    if (enabledToolIds.length === 0) {
      await this.recordToolCallLog({
        requestId: request.requestId,
        agentId: request.agentId,
        status: "skipped",
        source: "chat_start",
        reason: "bound_tools_not_available",
        output: {
          boundToolIds: request.toolIds,
          enabledToolIds
        }
      });
      return;
    }

    await this.recordToolCallLog({
      requestId: request.requestId,
      agentId: request.agentId,
      status: "available",
      source: "chat_start",
      output: {
        boundToolIds: request.toolIds,
        enabledToolIds
      }
    });
  }

  private async recordToolCallLog(record: ToolCallLogRecord): Promise<void> {
    const logger = (this.toolsService as Partial<ToolsService>).recordToolCallLog;

    if (typeof logger !== "function") {
      // 部分单测使用精简的 ToolsService mock，此时日志能力是可选的。
      return;
    }

    await logger.call(this.toolsService, record);
  }

  private buildSystemPrompt(systemPrompt: string, tools: LLMToolDefinition[]): string {
    if (tools.length === 0) {
      return systemPrompt;
    }

    const toolDescriptions = tools
      .map((tool) => {
        return `- ${tool.name}: ${tool.description}; parameters=${JSON.stringify(tool.parameters)}`;
      })
      .join("\n");

    return [
      systemPrompt,
      "",
      "工具调用规则：",
      "当用户问题需要实时信息、精确计算、当前日期时间或外部查询时，必须使用可用工具，不要猜测。",
      `如果需要获取当前时间且用户未指定时区，使用 ${DEFAULT_TIMEZONE}。`,
      "如果模型接口不支持原生工具调用，则只输出下面 JSON，不要输出解释文字：",
      "```json",
      '{"name":"tool_id","arguments":{}}',
      "```",
      "可用工具：",
      toolDescriptions,
      "拿到工具结果后，再基于工具结果用自然语言回答用户。"
    ].join("\n");
  }

  private inferToolCallFromUserMessage(
    message: string,
    tools: LLMToolDefinition[]
  ): LLMToolCall | null {
    const hasCurrentTimeTool = tools.some((tool) => tool.name === "current_time");

    if (!hasCurrentTimeTool) {
      return null;
    }

    if (
      !/(当前时间|现在几点|现在时间|今天|日期|星期|几点了|时间|time now|current time)/iu.test(
        message
      )
    ) {
      return null;
    }

    return {
      id: this.createToolCallId("current_time"),
      name: "current_time",
      arguments: {
        timezone: this.extractTimezone(message) ?? DEFAULT_TIMEZONE
      },
      rawArguments: ""
    };
  }

  private extractTimezone(message: string): string | null {
    if (
      /(美西|洛杉矶|旧金山|西雅图|Los Angeles|San Francisco|Seattle|Pacific Time|PST|PDT)/iu.test(
        message
      )
    ) {
      return "America/Los_Angeles";
    }

    if (/(美国|美东|纽约|华盛顿|New York|Washington|Eastern Time|EST|EDT)/iu.test(message)) {
      return "America/New_York";
    }

    if (/(纽约|New York)/iu.test(message)) {
      return "America/New_York";
    }

    if (/(东京|Tokyo)/iu.test(message)) {
      return "Asia/Tokyo";
    }

    if (/(伦敦|London)/iu.test(message)) {
      return "Europe/London";
    }

    if (/(上海|北京|中国|北京时间|Asia\/Shanghai)/iu.test(message)) {
      return DEFAULT_TIMEZONE;
    }

    return null;
  }

  private parseTextToolCalls(content: string, tools: LLMToolDefinition[]): LLMToolCall[] {
    if (tools.length === 0 || !content.trim()) {
      return [];
    }

    const toolNames = new Set(tools.map((tool) => tool.name));
    const parsed = this.parseToolCallJson(content);

    if (!parsed || !toolNames.has(parsed.name)) {
      return [];
    }

    return [
      {
        id: this.createToolCallId(parsed.name),
        name: parsed.name,
        arguments: parsed.arguments,
        rawArguments: JSON.stringify(parsed.arguments)
      }
    ];
  }

  private parseToolCallJson(content: string): {
    name: string;
    arguments: Record<string, unknown>;
  } | null {
    const candidates = [
      ...Array.from(content.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)).map((match) => match[1]),
      content
    ];

    for (const candidate of candidates) {
      const parsed = this.parseJsonObject(candidate.trim());

      if (
        parsed &&
        typeof parsed.name === "string" &&
        parsed.arguments &&
        typeof parsed.arguments === "object" &&
        !Array.isArray(parsed.arguments)
      ) {
        return {
          name: parsed.name,
          arguments: parsed.arguments as Record<string, unknown>
        };
      }
    }

    return null;
  }

  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        return null;
      }

      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async *executeToolCalls(
    toolCalls: LLMToolCall[],
    messages: ChatMessage[],
    context: {
      agentId: string;
      requestId: string;
      signal?: AbortSignal;
      source: string;
      assistantContent?: string;
    }
  ): AsyncIterable<ChatStreamEvent> {
    messages.push({
      role: "assistant",
      content: context.assistantContent ?? "",
      toolCalls
    });

    for (const toolCall of toolCalls) {
      // 执行前先记录模型已请求工具；ToolsService 会用同一组 requestId + toolCallId 记录执行结果。
      await this.recordToolCallLog({
        requestId: context.requestId,
        agentId: context.agentId,
        toolCallId: toolCall.id,
        toolId: toolCall.name,
        status: "requested",
        source: context.source,
        input: this.toToolInput(toolCall.arguments)
      });

      yield {
        type: "tool_call",
        data: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }
      };

      const result = await this.toolsService.executeTool({
        toolId: toolCall.name,
        input: this.toToolInput(toolCall.arguments),
        toolCallId: toolCall.id,
        requestId: context.requestId,
        agentId: context.agentId,
        signal: context.signal
      });

      yield {
        type: "tool_result",
        data: result
      };

      messages.push(
        this.toToolResultMessage(
          toolCall,
          result.ok
            ? (result.output ?? null)
            : {
                errorType: result.errorType,
                errorMessage: result.errorMessage
              }
        )
      );
    }
  }

  private async executeToolCallsForCompletion(
    toolCalls: LLMToolCall[],
    messages: ChatMessage[],
    context: {
      requestId: string;
      agentId: string;
      source: string;
    }
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      // 非流式调用也使用 requested -> completed/failed 的日志配对，方便和 SSE 路径统一查询。
      await this.recordToolCallLog({
        requestId: context.requestId,
        agentId: context.agentId,
        toolCallId: toolCall.id,
        toolId: toolCall.name,
        status: "requested",
        source: context.source,
        input: this.toToolInput(toolCall.arguments)
      });

      const result = await this.toolsService.executeTool({
        toolId: toolCall.name,
        input: this.toToolInput(toolCall.arguments),
        toolCallId: toolCall.id,
        requestId: context.requestId,
        agentId: context.agentId
      });

      messages.push(
        this.toToolResultMessage(
          toolCall,
          result.ok
            ? (result.output ?? null)
            : {
                errorType: result.errorType,
                errorMessage: result.errorMessage
              }
        )
      );
    }
  }

  private toToolResultMessage(toolCall: LLMToolCall, result: unknown): ChatMessage {
    return {
      role: "tool",
      toolCallId: toolCall.id,
      content: JSON.stringify(result)
    };
  }

  private createToolCallId(toolName: string): string {
    return `call_${toolName}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  private formatLatestToolResultAnswer(messages: ChatMessage[]): string {
    const result = this.getLatestToolResult(messages);

    if (!result) {
      return "";
    }

    if ("errorType" in result || "errorMessage" in result) {
      return `工具调用失败：${String(result.errorMessage || result.errorType || "未知错误")}`;
    }

    if (typeof result.localTime === "string") {
      const timezone = typeof result.timezone === "string" ? result.timezone : DEFAULT_TIMEZONE;
      return `当前时间是 ${result.localTime}（${timezone}）。`;
    }

    if (typeof result.result === "number") {
      return `计算结果是 ${result.result}。`;
    }

    if (typeof result.url === "string" && typeof result.status === "number") {
      const method = typeof result.method === "string" ? result.method : "GET";
      const bodyPreview = this.formatToolResultPreview(result.body);
      return `HTTP 请求完成：${method} ${result.url} 返回 ${result.status}。${bodyPreview}`;
    }

    return `工具执行完成：${JSON.stringify(result)}`;
  }

  private getToolResultFallbackAnswer(messages: ChatMessage[], assistantContent: string): string {
    const content = assistantContent.trim();

    if (!content) {
      return this.formatLatestToolResultAnswer(messages);
    }

    const latestResult = this.getLatestToolResult(messages);

    if (!latestResult || !("url" in latestResult)) {
      return "";
    }

    if (!this.isDistractedToolFollowup(content)) {
      return "";
    }

    return this.formatLatestToolResultAnswer(messages);
  }

  private getLatestToolResult(messages: ChatMessage[]): Record<string, unknown> | null {
    const latestToolMessage = [...messages]
      .reverse()
      .find((message) => message.role === "tool" && typeof message.content === "string");

    if (!latestToolMessage || typeof latestToolMessage.content !== "string") {
      return null;
    }

    return this.parseJsonObject(latestToolMessage.content);
  }

  private isDistractedToolFollowup(content: string): boolean {
    return /正在(查询|获取|调用)|请稍等|稍等片刻|当前时间|现在时间|now checking|please wait/iu.test(
      content
    );
  }

  private formatToolResultPreview(value: unknown): string {
    if (value === undefined || value === null || value === "") {
      return "";
    }

    const text = typeof value === "string" ? value : JSON.stringify(value);
    const compact = text.replace(/\s+/gu, " ").trim();
    const preview = compact.length > 300 ? `${compact.slice(0, 300)}...` : compact;

    return `响应：${preview}`;
  }

  private toToolInput(value: Record<string, unknown>): Record<string, ToolJsonValue> {
    const input: Record<string, ToolJsonValue> = {};

    for (const [key, item] of Object.entries(value)) {
      input[key] = this.toToolJsonValue(item);
    }

    return input;
  }

  private toToolJsonValue(value: unknown): ToolJsonValue {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.toToolJsonValue(item));
    }

    if (value && typeof value === "object") {
      return this.toToolInput(value as Record<string, unknown>);
    }

    return null;
  }

  private normalizeHistory(history: ChatMessageDto[] | undefined, maxTurns: number): ChatMessage[] {
    if (!Array.isArray(history) || maxTurns <= 0) {
      return [];
    }

    const normalized = history.flatMap((item): ChatMessage[] => {
      const role = item?.role;
      const content = typeof item?.content === "string" ? item.content.trim() : "";

      if ((role !== "user" && role !== "assistant") || content.length === 0) {
        return [];
      }

      return [
        {
          role,
          content
        }
      ];
    });

    return normalized.slice(-maxTurns * 2);
  }

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
          type: "image_url" as const,
          image_url: {
            url: image.dataUrl
          }
        }))
      ]
    };
  }

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
