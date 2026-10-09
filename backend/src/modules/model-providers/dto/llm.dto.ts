import { ModelProviderType, ModelThinkingMode } from "@prisma/client";

/** Provider Gateway 支持的标准对话角色。 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 统一的多模态消息片段；供应商差异由 Client 层转换。 */
export type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

/** 业务模块传给模型网关的标准消息，不暴露供应商 SDK 类型。 */
export type ChatMessage = {
  /** 消息角色。 */
  role: ChatRole;
  /** 纯文本或受控的多模态内容。 */
  content: string | ChatContentPart[];
  /** tool 角色消息对应的模型工具调用 ID。 */
  toolCallId?: string;
  /** assistant 消息中模型请求执行的工具。 */
  toolCalls?: LLMToolCall[];
};

/** 提供给模型的统一工具定义。 */
export type LLMToolDefinition = {
  /** 模型可调用的稳定工具名称。 */
  name: string;
  /** 帮助模型判断使用时机的说明。 */
  description: string;
  /** JSON Schema 形式的工具参数约束。 */
  parameters: Record<string, unknown>;
};

/** 从供应商响应归一化后的单次工具调用。 */
export type LLMToolCall = {
  /** 供应商生成的调用 ID，用于回传工具结果。 */
  id: string;
  /** 模型选择的工具名称。 */
  name: string;
  /** 成功解析后的结构化参数。 */
  arguments: Record<string, unknown>;
  /** 原始参数文本，用于解析失败排障。 */
  rawArguments: string;
};

/** 业务模块发起 Chat Completion 的统一请求。 */
export type ChatCompletionRequest = {
  /** Mia 模型配置 ID，Gateway 据此加载供应商和密钥。 */
  modelConfigId: string;
  /** 已按上下文策略裁剪的标准消息。 */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none";
  /** 用户取消或 SSE 断开时传递给上游请求。 */
  signal?: AbortSignal;
};

/** 业务模块发起 Embedding 的统一请求。 */
export type EmbeddingRequest = {
  /** Embedding 类型模型配置 ID。 */
  modelConfigId: string;
  /** 单条或批量待向量化文本。 */
  input: string | string[];
  /** 覆盖模型配置的单次超时秒数。 */
  timeoutSeconds?: number;
  /** 上游取消信号。 */
  signal?: AbortSignal;
};

/** 归一化后的 Embedding 响应。 */
export type EmbeddingResponse = {
  /** 与请求输入顺序一一对应的向量。 */
  embeddings: number[][];
  /** 供应商实际返回的模型名。 */
  model: string;
  /** 实际调用的供应商 ID。 */
  providerId: string;
  /** 实际调用的供应商类型。 */
  providerType: ModelProviderType;
  /** 供应商提供时记录的 token 用量。 */
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
};

/** 非流式 Chat Completion 的归一化响应。 */
export type ChatCompletionResponse = {
  /** 模型生成的文本内容。 */
  content: string;
  /** 供应商返回的推理文本；仅供受控调用方使用，不应默认展示或持久化。 */
  reasoningContent?: string;
  /** 供应商实际返回的模型名。 */
  model: string;
  /** 实际调用的供应商 ID。 */
  providerId: string;
  /** 实际调用的供应商类型。 */
  providerType: ModelProviderType;
  /** 模型请求执行的工具调用。 */
  toolCalls?: LLMToolCall[];
  /** 供应商提供时记录的 token 用量。 */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

/** 流式 Chat 的统一增量事件；Client 必须在此层消化供应商协议差异。 */
export type ChatStreamChunk =
  | {
      type: "token";
      content: string;
    }
  | {
      /** 推理增量仅用于延迟观测，业务层不得默认展示或持久化原文。 */
      type: "reasoning_token";
      content: string;
    }
  | {
      type: "tool_call";
      toolCall: LLMToolCall;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      errorMessage?: string;
    };

/** Gateway 解析后的供应商运行配置，仅限模型模块内部使用。 */
export type ProviderRuntimeConfig = {
  /** 供应商配置 ID。 */
  providerId: string;
  /** 决定具体 Client 实现的供应商类型。 */
  providerType: ModelProviderType;
  /** 已归一化的 API Base URL。 */
  baseUrl: string;
  /** 解密后的密钥，禁止写入日志或返回通用调用方。 */
  apiKey: string;
  /** 供应商侧模型名称。 */
  modelName: string;
  /** 模型配置的默认总超时秒数。 */
  timeoutSeconds: number;
  /** 默认生成上限；null 表示不覆盖供应商默认值。 */
  maxTokens: number | null;
  /** 模型级思考模式，由具体 Provider Client 转换成供应商协议参数。 */
  thinkingMode: ModelThinkingMode;
};

/** Gateway 传给具体 Provider Client 的 Chat 请求。 */
export type ProviderChatRequest = {
  /** 已归一化的消息。 */
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number | null;
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none";
  /** Gateway 合并超时和用户取消后的必传信号。 */
  signal: AbortSignal;
};

/** Gateway 传给具体 Provider Client 的 Embedding 请求。 */
export type ProviderEmbeddingRequest = {
  /** 单条或批量输入文本。 */
  input: string | string[];
  /** Gateway 合并超时和用户取消后的必传信号。 */
  signal: AbortSignal;
};

/** 管理端测试模型连通性与生成能力的请求。 */
export type TestChatCompletionDto = {
  /** 可选完整消息；提供时优先于 prompt。 */
  messages?: ChatMessage[];
  /** 简单测试场景使用的用户文本。 */
  prompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  timeoutSeconds?: number;
};
