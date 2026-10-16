import { ChatSessionStatus } from "@prisma/client";
import { AgentContentPart } from "../../agent_runtime/dto/content-part.dto";

/** 持久消息保存的运行快照。字段均可 JSON 序列化，旧消息可以没有该结构。 */
export type ChatMessageMetadata = {
  requestId?: string;
  runId?: string;
  modelConfigId?: string;
  modelName?: string;
  providerName?: string;
  elapsedMs?: number;
  firstTokenMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCost?: number };
  retrievalEvents?: Array<{
    knowledgeBaseIds: string[];
    status: "success";
    sources: Array<Record<string, unknown>>;
    elapsedMs?: number;
  }>;
  toolEvents?: Array<{
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
    status: "success" | "error";
    output?: unknown;
    errorType?: string;
    errorMessage?: string;
    elapsedMs?: number;
  }>;
  toolSearch?: {
    boundToolCount?: number;
    catalogMatchCount?: number;
    selectedToolIds?: string[];
  };
};

/** 会话列表查询参数；cursor 与 pageSize 由 service 统一校验和归一化。 */
export type ChatSessionListQueryDto = {
  /** 限定查询的 Agent ID。 */
  agentId?: string;
  /** 会话生命周期状态，默认查询活跃会话。 */
  status?: ChatSessionStatus;
  /** 下一页复合游标。 */
  cursor?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
};

/** 创建持久会话所需参数。 */
export type CreateChatSessionDto = {
  /** 要创建会话的持久模式 Agent ID。 */
  agentId?: string;
};

/** 当前允许修改的会话元数据。 */
export type UpdateChatSessionDto = {
  /** 新会话标题。 */
  title?: string;
};

/** 成员对 Assistant 消息提交的赞踩和可选原因。 */
export type ChatMessageFeedbackDto = {
  rating?: "UP" | "DOWN";
  reason?: string;
};

/** 已保存的消息反馈。 */
export type ChatMessageFeedbackResponse = {
  messageId: string;
  rating: "UP" | "DOWN";
  reason: string | null;
};

/** 会话消息向前翻页的查询参数。 */
export type ChatMessageQueryDto = {
  /** 向更早消息翻页的复合游标。 */
  before?: string;
  /** 每页记录数的原始查询字符串。 */
  pageSize?: string;
};

/** 会话列表游标的可序列化结构。 */
export type ChatSessionCursor = {
  /** 游标排序时间的 ISO 字符串。 */
  createdAt: string;
  /** 同一时间下用于稳定排序的会话 ID。 */
  id: string;
};

/** 会话侧栏展示所需的稳定摘要。 */
export type ChatSessionListItem = {
  /** 会话 ID。 */
  id: string;
  /** 会话所属 Agent ID。 */
  agentId: string;
  /** 会话展示标题。 */
  title: string;
  /** 会话当前生命周期状态。 */
  status: ChatSessionStatus;
  /** 最近一条消息时间；空会话为 null。 */
  lastMessageAt: Date | null;
  /** 会话创建时间。 */
  createdAt: Date;
  /** 会话最近更新时间。 */
  updatedAt: Date;
};

/** 一页会话列表及下一页游标。 */
export type ChatSessionListResponse = {
  /** 当前页会话摘要。 */
  list: ChatSessionListItem[];
  /** 下一页游标；没有下一页时为 null。 */
  nextCursor: string | null;
  /** 是否仍有后续会话。 */
  hasMore: boolean;
};

/** 持久会话中的单条历史消息。 */
export type ChatSessionMessageListItem = {
  /** 消息 ID。 */
  id: string;
  /** 消息发送方。 */
  role: "user" | "assistant";
  /** 消息正文。 */
  content: string;
  /** 有序多类型内容；旧数据由服务层从 content 补成 text 块。 */
  contentParts: AgentContentPart[];
  /** 回答运行快照；旧消息和用户消息通常为 null。 */
  metadata: ChatMessageMetadata | null;
  /** 当前成员已经提交的反馈。 */
  feedback: ChatMessageFeedbackResponse | null;
  /** 消息创建时间。 */
  createdAt: Date;
};

/** 一页历史消息；nextBefore 用于继续向更早的消息翻页。 */
export type ChatSessionMessagePage = {
  /** 当前页消息，返回给页面时按时间正序排列。 */
  list: ChatSessionMessageListItem[];
  /** 继续加载更早消息的游标。 */
  nextBefore: string | null;
  /** 是否仍有更早消息。 */
  hasMore: boolean;
};
