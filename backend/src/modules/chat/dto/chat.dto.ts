/** 一轮对话中可进入模型上下文的标准消息。 */
export type ChatMessageDto = {
  /** 消息发送方；当前上下文不接受 system/tool 角色由客户端直接注入。 */
  role: "user" | "assistant";
  /** 消息文本正文。 */
  content: string;
  /** 用户消息携带的图片附件。 */
  images?: ChatImageAttachmentDto[];
  /** 用户消息携带的文本文件附件。 */
  files?: ChatFileAttachmentDto[];
};

/** 随用户消息提交的图片附件；dataUrl 用于直接传递给支持视觉输入的模型。 */
export type ChatImageAttachmentDto = {
  /** 原始文件名，用于提示模型和日志排查。 */
  name: string;
  /** 图片 MIME 类型。 */
  mimeType: string;
  /** 包含图片内容的 Data URL。 */
  dataUrl: string;
};

/** 随用户消息提交的文本文件附件；服务端会将 content 合并到模型上下文。 */
export type ChatFileAttachmentDto = {
  /** 原始文件名。 */
  name: string;
  /** 文件 MIME 类型。 */
  mimeType: string;
  /** 客户端报告的文件字节数。 */
  size: number;
  /** 已读取的纯文本内容。 */
  content: string;
};

/** 发起同步或流式对话时的请求参数。 */
export type ChatCompletionDto = {
  /** 要运行的 Agent ID。 */
  agentId?: string;
  /** 持久会话 ID；临时会话可以不传。 */
  sessionId?: string;
  /** 本轮用户输入正文。 */
  message?: string;
  /** 本轮图片附件。 */
  images?: ChatImageAttachmentDto[];
  /** 本轮文本文件附件。 */
  files?: ChatFileAttachmentDto[];
  /** 临时会话由客户端提供的历史消息。 */
  history?: ChatMessageDto[];
};

/** 兼容旧会话读取接口返回的精简消息。 */
export type ChatSessionMessageDto = {
  /** 持久化消息 ID。 */
  id: string;
  /** 消息发送方。 */
  role: "user" | "assistant";
  /** 消息正文。 */
  content: string;
  /** 消息创建时间。 */
  createdAt: Date;
};

/** 兼容旧聊天页的单会话响应，并显式区分临时与持久会话模式。 */
export type ChatSessionResponse = {
  /** Agent 配置的会话模式。 */
  mode: "EPHEMERAL" | "PERSISTENT";
  /** 当前持久会话 ID；临时模式下为 null。 */
  sessionId: string | null;
  /** 当前会话已有消息。 */
  messages: ChatSessionMessageDto[];
};

/** 非流式模型调用完成后的统一结果。 */
export type ChatCompletionResult = {
  /** 实际运行的 Agent ID。 */
  agentId: string;
  /** 实际使用的模型配置 ID。 */
  modelConfigId: string;
  /** 实际使用的模型名称。 */
  modelName: string;
  /** 实际使用的供应商名称。 */
  providerName: string;
  /** 模型生成的最终正文。 */
  content: string;
};

/** Chat SSE 对外公开的固定事件集合。 */
export type ChatStreamEventType =
  | "message_start"
  | "tool_search_start"
  | "tool_search_result"
  | "retrieval_start"
  | "retrieval_result"
  | "token"
  | "tool_call"
  | "tool_approval_required"
  | "tool_approval_resolved"
  | "tool_result"
  | "message_end"
  | "error"
  | "ping";

/** Chat SSE 事件信封；具体 data 字段由事件 type 决定。 */
export type ChatStreamEvent = {
  /** 决定前端状态流转方式的事件名称。 */
  type: ChatStreamEventType;
  /** 事件载荷；具体字段由 type 对应协议定义。 */
  data: Record<string, unknown>;
};
