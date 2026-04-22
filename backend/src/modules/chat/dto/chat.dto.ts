export type ChatMessageDto = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatCompletionDto = {
  agentId?: string;
  message?: string;
  history?: ChatMessageDto[];
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};
