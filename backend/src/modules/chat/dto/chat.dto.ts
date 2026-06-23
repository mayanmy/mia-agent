export type ChatMessageDto = {
  role: "user" | "assistant";
  content: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
};

export type ChatImageAttachmentDto = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatFileAttachmentDto = {
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

export type ChatCompletionDto = {
  agentId?: string;
  message?: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
  history?: ChatMessageDto[];
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

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

export type ChatStreamEvent = {
  type: ChatStreamEventType;
  data: Record<string, unknown>;
};
