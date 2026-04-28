export type ChatMessageDto = {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImageAttachmentDto[];
};

export type ChatImageAttachmentDto = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatCompletionDto = {
  agentId?: string;
  message?: string;
  images?: ChatImageAttachmentDto[];
  history?: ChatMessageDto[];
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

export type ChatStreamEventType = 'message_start' | 'token' | 'message_end' | 'error' | 'ping';

export type ChatStreamEvent = {
  type: ChatStreamEventType;
  data: Record<string, unknown>;
};
