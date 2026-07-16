import { ChatSessionStatus } from "@prisma/client";

export type ChatSessionListQueryDto = {
  agentId?: string;
  status?: ChatSessionStatus;
  cursor?: string;
  pageSize?: string;
};

export type CreateChatSessionDto = {
  agentId?: string;
};

export type UpdateChatSessionDto = {
  title?: string;
};

export type ChatMessageQueryDto = {
  before?: string;
  pageSize?: string;
};

export type ChatSessionCursor = {
  createdAt: string;
  id: string;
};

export type ChatSessionListItem = {
  id: string;
  agentId: string;
  title: string;
  status: ChatSessionStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatSessionListResponse = {
  list: ChatSessionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ChatSessionMessageListItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
};

export type ChatSessionMessagePage = {
  list: ChatSessionMessageListItem[];
  nextBefore: string | null;
  hasMore: boolean;
};
