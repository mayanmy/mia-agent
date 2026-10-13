import { HttpStatus, Injectable } from "@nestjs/common";
import { ModelProvider, ModelProviderType, ModelThinkingMode } from "@prisma/client";

import { decryptSecret } from "../../core/crypto";
import { getWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderClient } from "./clients/base.client";
import { OllamaClient } from "./clients/ollama.client";
import { OpenAICompatibleClient } from "./clients/openai-compatible.client";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderRuntimeConfig
} from "./dto/llm.dto";

/** Prisma 查询结果在模型模块内部转换成运行配置，不向业务模块暴露 ORM Model。 */
type ModelConfigWithProvider = {
  id: string;
  modelName: string;
  timeoutSeconds: number;
  maxTokens: number | null;
  thinkingMode: ModelThinkingMode;
  thinkingSupported: boolean;
  provider: ModelProvider;
};

@Injectable()
export class ModelProvidersGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openAICompatibleClient: OpenAICompatibleClient,
    private readonly ollamaClient: OllamaClient
  ) {}

  /** 非流式 Chat 的统一入口，负责配置加载、取消传播、超时和错误归一化。 */
  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const { config, messages, timeoutMs } = await this.prepareChatCall(request);
    const controller = new AbortController();
    // 合并调用方取消与模型级总超时，确保任一条件发生都能关闭上游 HTTP 请求。
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.getClient(config.providerType).createChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        tools: this.normalizeTools(request.tools),
        toolChoice: request.toolChoice,
        signal: controller.signal
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      // 无论成功、失败还是取消都清理定时器与监听器，避免长时间运行后积累闭包。
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  /** Embedding 的统一入口，与 Chat 共用相同取消和错误边界。 */
  async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const { config, input, timeoutMs } = await this.prepareEmbeddingCall(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.getClient(config.providerType).createEmbedding(config, {
        input,
        signal: controller.signal
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  /** 流式 Chat 在生成器 finally 中释放超时和取消监听，覆盖消费者提前停止迭代的场景。 */
  async *streamChatCompletion(request: ChatCompletionRequest): AsyncIterable<ChatStreamChunk> {
    const { config, messages, timeoutMs } = await this.prepareChatCall(request);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      yield* this.getClient(config.providerType).streamChatCompletion(config, {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
        tools: this.normalizeTools(request.tools),
        toolChoice: request.toolChoice,
        signal: controller.signal
      });
    } catch (error) {
      throw this.normalizeProviderError(error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  private async prepareChatCall(request: ChatCompletionRequest): Promise<{
    config: ProviderRuntimeConfig;
    messages: ChatMessage[];
    timeoutMs: number;
  }> {
    const modelConfig = await this.findModelConfig(request.modelConfigId);
    const timeoutSeconds = request.timeoutSeconds ?? modelConfig.timeoutSeconds;

    return {
      config: {
        providerId: modelConfig.provider.id,
        providerType: modelConfig.provider.providerType,
        baseUrl: modelConfig.provider.baseUrl,
        // 密钥只在即将调用供应商时解密，并限制在模型模块运行配置内。
        apiKey: modelConfig.provider.apiKeyEncrypted
          ? decryptSecret(modelConfig.provider.apiKeyEncrypted)
          : "",
        modelName: modelConfig.modelName,
        timeoutSeconds,
        maxTokens: modelConfig.maxTokens,
        thinkingMode: modelConfig.thinkingSupported
          ? (request.thinkingMode ?? modelConfig.thinkingMode)
          : ModelThinkingMode.AUTO
      },
      messages: this.requireMessages(request.messages),
      timeoutMs: timeoutSeconds * 1000
    };
  }

  private async prepareEmbeddingCall(request: EmbeddingRequest): Promise<{
    config: ProviderRuntimeConfig;
    input: string | string[];
    timeoutMs: number;
  }> {
    const modelConfig = await this.findModelConfig(request.modelConfigId);
    const timeoutSeconds = request.timeoutSeconds ?? modelConfig.timeoutSeconds;

    return {
      config: {
        providerId: modelConfig.provider.id,
        providerType: modelConfig.provider.providerType,
        baseUrl: modelConfig.provider.baseUrl,
        apiKey: modelConfig.provider.apiKeyEncrypted
          ? decryptSecret(modelConfig.provider.apiKeyEncrypted)
          : "",
        modelName: modelConfig.modelName,
        timeoutSeconds,
        maxTokens: modelConfig.maxTokens,
        thinkingMode: modelConfig.thinkingMode
      },
      input: this.requireEmbeddingInput(request.input),
      timeoutMs: timeoutSeconds * 1000
    };
  }

  private async findModelConfig(id: string): Promise<ModelConfigWithProvider> {
    // 同时校验模型和供应商启用/软删除状态，避免绕过管理端禁用继续发起外部调用。
    const modelConfig = await this.prisma.modelConfig.findFirst({
      where: {
        id,
        ...(getWorkspaceId() ? { workspaceId: getWorkspaceId()! } : {}),
        enabled: true,
        deletedAt: null,
        provider: {
          enabled: true,
          deletedAt: null
        }
      },
      select: {
        id: true,
        modelName: true,
        timeoutSeconds: true,
        maxTokens: true,
        thinkingMode: true,
        thinkingSupported: true,
        provider: true
      }
    });

    if (!modelConfig) {
      throw new AppError(
        ErrorCodes.provider.modelConfigNotFound,
        "model config not found or disabled",
        HttpStatus.NOT_FOUND
      );
    }

    return modelConfig;
  }

  private requireMessages(messages: ChatMessage[]): ChatMessage[] {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, "messages is required");
    }

    return messages.map((message) => {
      if (
        !message ||
        (message.role !== "system" &&
          message.role !== "user" &&
          message.role !== "assistant" &&
          message.role !== "tool") ||
        !this.isValidMessageContent(message.content, message)
      ) {
        throw new AppError(ErrorCodes.common.badRequest, "messages is invalid");
      }

      return {
        role: message.role,
        content: typeof message.content === "string" ? message.content.trim() : message.content,
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {})
      };
    });
  }

  private requireEmbeddingInput(input: string | string[]): string | string[] {
    if (typeof input === "string") {
      const value = input.trim();

      if (!value) {
        throw new AppError(ErrorCodes.common.badRequest, "embedding input is required");
      }

      return value;
    }

    if (!Array.isArray(input) || input.length === 0) {
      throw new AppError(ErrorCodes.common.badRequest, "embedding input is required");
    }

    return input.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new AppError(ErrorCodes.common.badRequest, "embedding input is invalid");
      }

      return item.trim();
    });
  }

  private normalizeTools(tools: ChatCompletionRequest["tools"]): ChatCompletionRequest["tools"] {
    if (!tools) {
      return undefined;
    }

    if (!Array.isArray(tools)) {
      throw new AppError(ErrorCodes.common.badRequest, "tools is invalid");
    }

    return tools.map((tool) => {
      if (
        !tool ||
        typeof tool.name !== "string" ||
        tool.name.trim().length === 0 ||
        typeof tool.description !== "string" ||
        !tool.parameters ||
        typeof tool.parameters !== "object" ||
        Array.isArray(tool.parameters)
      ) {
        throw new AppError(ErrorCodes.common.badRequest, "tools is invalid");
      }

      return {
        name: tool.name.trim(),
        description: tool.description,
        parameters: tool.parameters
      };
    });
  }

  private isValidMessageContent(content: unknown, message?: ChatMessage): boolean {
    // assistant 发起工具调用时允许正文为空，工具调用本身就是有效输出。
    if (message?.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return typeof content === "string";
    }

    if (typeof content === "string") {
      return content.trim().length > 0;
    }

    if (!Array.isArray(content) || content.length === 0) {
      return false;
    }

    return content.every((part) => {
      if (!part || typeof part !== "object") {
        return false;
      }

      if ("type" in part && part.type === "text") {
        return "text" in part && typeof part.text === "string" && part.text.trim().length > 0;
      }

      if ("type" in part && part.type === "image") {
        return (
          "mimeType" in part &&
          typeof part.mimeType === "string" &&
          part.mimeType.startsWith("image/") &&
          "dataUrl" in part &&
          typeof part.dataUrl === "string" &&
          // 只接受业务层已经校验的内联图片，禁止模型网关代取任意 URL 形成 SSRF 通道。
          part.dataUrl.startsWith(`data:${part.mimeType};base64,`)
        );
      }

      return false;
    });
  }

  private getClient(providerType: ModelProviderType): ProviderClient {
    if (providerType === ModelProviderType.OLLAMA) {
      return this.ollamaClient;
    }

    if (providerType === ModelProviderType.OPENAI_COMPATIBLE) {
      return this.openAICompatibleClient;
    }

    throw new AppError(
      ErrorCodes.provider.connectionFailed,
      `${providerType} chat completion is not supported yet`,
      HttpStatus.BAD_REQUEST
    );
  }

  private normalizeProviderError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      // 目前调用方取消与超时共用 AbortSignal；上层 Runtime 会再结合自身 signal 映射 canceled。
      return new AppError(
        ErrorCodes.provider.connectionFailed,
        "provider request timeout",
        HttpStatus.GATEWAY_TIMEOUT
      );
    }

    return new AppError(
      ErrorCodes.provider.connectionFailed,
      error instanceof Error ? error.message : "provider request failed",
      HttpStatus.BAD_GATEWAY
    );
  }
}
