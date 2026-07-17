import { ChatFileAttachmentDto, ChatImageAttachmentDto } from "../../chat/dto/chat.dto";

export type CreateAgentApiKeyDto = {
  name?: string;
  expiresAt?: string | null;
};

export type AgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type CreatedAgentApiKey = AgentApiKeyListItem & {
  apiKey: string;
};

export type PublicAgentProfile = {
  id: string;
  name: string;
  description: string;
  modelName: string;
  providerName: string;
};

export type PublicChatMessageDto = {
  agentToken?: string;
  sessionId?: string;
  conversationId?: string;
  message?: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
};

export type ServiceChatMessageDto = {
  query?: string;
  response_mode?: "streaming" | "blocking";
  user?: string;
  conversation_id?: string;
  inputs?: Record<string, unknown>;
  files?: ChatFileAttachmentDto[];
  images?: ChatImageAttachmentDto[];
};

export type ExternalConversationListQueryDto = {
  user?: string;
  limit?: string;
};

export type ExternalConversationMessageQueryDto = {
  user?: string;
  limit?: string;
};

export type ExternalConversationListItem = {
  id: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExternalMessageListItem = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};
