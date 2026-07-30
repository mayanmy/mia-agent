import { ChatSessionStatus } from "@prisma/client";

/** 会话列表查询参数；cursor 与 pageSize 由 service 统一校验和归一化。 */
export type ChatSessionListQueryDto = {
  agentId?: string;
  status?: ChatSessionStatus;
  cursor?: string;
  pageSize?: string;
};

/** 创建持久会话所需参数。 */
export type CreateChatSessionDto = {
  agentId?: string;
};

/** 当前允许修改的会话元数据。 */
export type UpdateChatSessionDto = {
  title?: string;
};

/** 会话消息向前翻页的查询参数。 */
export type ChatMessageQueryDto = {
  before?: string;
  pageSize?: string;
};

/** 会话列表游标的可序列化结构。 */
export type ChatSessionCursor = {
  createdAt: string;
  id: string;
};

/** 会话侧栏展示所需的稳定摘要。 */
export type ChatSessionListItem = {
  id: string;
  agentId: string;
  title: string;
  status: ChatSessionStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 一页会话列表及下一页游标。 */
export type ChatSessionListResponse = {
  list: ChatSessionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** 持久会话中的单条历史消息。 */
export type ChatSessionMessageListItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

/** 一页历史消息；nextBefore 用于继续向更早的消息翻页。 */
export type ChatSessionMessagePage = {
  list: ChatSessionMessageListItem[];
  nextBefore: string | null;
  hasMore: boolean;
};
