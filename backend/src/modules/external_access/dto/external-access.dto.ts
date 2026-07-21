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
  passwordRequired: boolean;
};

export type PublicChatMessageDto = {
  agentToken?: string;
  sessionId?: string;
  conversationId?: string;
  message?: string;
  images?: ChatImageAttachmentDto[];
  files?: ChatFileAttachmentDto[];
  password?: string;
};

/** Widget 恢复历史时携带密码，避免受密码保护的会话被只读接口绕过。 */
export type PublicConversationMessagesDto = {
  agentToken?: string;
  sessionId?: string;
  limit?: string;
  password?: string;
};

/** 管理端更新公开分享治理设置；undefined 表示保留现有值，null 表示明确清空。 */
export type UpdatePublicAccessConfigDto = {
  publicExpiresAt?: string | null;
  allowedOrigins?: string[];
  password?: string | null;
};

export type PublicAccessConfigResponse = {
  agentId: string;
  publicExpiresAt: Date | null;
  allowedOrigins: string[];
  passwordRequired: boolean;
};

export type VerifyPublicAccessDto = {
  password?: string;
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
