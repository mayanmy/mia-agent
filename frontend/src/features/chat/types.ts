import type {
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatRetrievalSource
} from "./api";

/** 工具从发起到完成期间在聊天消息中的 UI 状态。 */
export type ChatToolEvent = {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  status: "running" | "success" | "error";
  output?: unknown;
  errorType?: string;
  errorMessage?: string;
  elapsedMs?: number;
};

/** 一次知识检索在聊天消息中的 UI 状态及来源快照。 */
export type ChatRetrievalEvent = {
  id: string;
  knowledgeBaseIds: string[];
  status: "running" | "success";
  sources: ChatRetrievalSource[];
  elapsedMs?: number;
};

/** 前端渲染使用的消息模型，在 API 消息上扩展本地状态和过程事件。 */
export type ChatUiMessage = ChatMessage & {
  id: string;
  createdAt: number;
  retrievalEvents?: ChatRetrievalEvent[];
  toolEvents?: ChatToolEvent[];
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
};
