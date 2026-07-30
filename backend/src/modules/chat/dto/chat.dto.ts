/** 一轮对话中可进入模型上下文的标准消息。 */
export type ChatMessageDto = {
  role: "user" | "assistant";
  content: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
};

/** 随用户消息提交的图片附件；dataUrl 用于直接传递给支持视觉输入的模型。 */
export type ChatImageAttachmentDto = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

/** 随用户消息提交的文本文件附件；服务端会将 content 合并到模型上下文。 */
export type ChatFileAttachmentDto = {
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

/** 发起同步或流式对话时的请求参数。 */
export type ChatCompletionDto = {
  agentId?: string;
  sessionId?: string;
  message?: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
  history?: ChatMessageDto[];
};

/** 兼容旧会话读取接口返回的精简消息。 */
export type ChatSessionMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

/** 兼容旧聊天页的单会话响应，并显式区分临时与持久会话模式。 */
export type ChatSessionResponse = {
  mode: "EPHEMERAL" | "PERSISTENT";
  sessionId: string | null;
  messages: ChatSessionMessageDto[];
};

/** 非流式模型调用完成后的统一结果。 */
export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

/** Chat SSE 对外公开的固定事件集合。 */
export type ChatStreamEventType =
  | "message_start"
  | "retrieval_start"
  | "retrieval_result"
  | "token"
  | "tool_call"
  | "tool_result"
  | "message_end"
  | "error"
  | "ping";

/** Chat SSE 事件信封；具体 data 字段由事件 type 决定。 */
export type ChatStreamEvent = {
  type: ChatStreamEventType;
  data: Record<string, unknown>;
};
