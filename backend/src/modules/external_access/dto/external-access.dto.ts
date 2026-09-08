import { ChatFileAttachmentDto, ChatImageAttachmentDto } from "../../chat/dto/chat.dto";

/** 创建 Agent API Key 时的可选名称。 */
export type CreateAgentApiKeyDto = {
  name?: string;
  expiresAt?: string | null;
};

/** Agent API Key 管理列表的安全摘要。 */
export type AgentApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/** 创建/轮换时唯一一次返回的原始 API Key。 */
export type CreatedAgentApiKey = AgentApiKeyListItem & {
  apiKey: string;
};

/** 公开页面可读取的最小 Agent 资料。 */
export type PublicAgentProfile = {
  id: string;
  name: string;
  description: string;
  modelName: string;
  providerName: string;
  passwordRequired: boolean;
};

/** 匿名公开页发起对话的消息输入。 */
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

/** Agent 公开访问开关和密码状态，不回显密码哈希。 */
export type PublicAccessConfigResponse = {
  agentId: string;
  publicExpiresAt: Date | null;
  allowedOrigins: string[];
  passwordRequired: boolean;
};

/** 公开页验证访问密码的输入。 */
export type VerifyPublicAccessDto = {
  password?: string;
};

/** 服务端 API Key 调用发起对话的输入。 */
export type ServiceChatMessageDto = {
  query?: string;
  response_mode?: "streaming" | "blocking";
  user?: string;
  conversation_id?: string;
  inputs?: Record<string, unknown>;
  files?: ChatFileAttachmentDto[];
  images?: ChatImageAttachmentDto[];
};

/** 外部会话列表的游标分页参数。 */
export type ExternalConversationListQueryDto = {
  user?: string;
  limit?: string;
};

/** 外部会话消息的向前游标分页参数。 */
export type ExternalConversationMessageQueryDto = {
  user?: string;
  limit?: string;
};

/** 外部会话列表摘要。 */
export type ExternalConversationListItem = {
  id: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 外部会话中的单条消息。 */
export type ExternalMessageListItem = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};
