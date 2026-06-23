import type {
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatRetrievalSource
} from "./api";

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

export type ChatRetrievalEvent = {
  id: string;
  knowledgeBaseIds: string[];
  status: "running" | "success";
  sources: ChatRetrievalSource[];
  elapsedMs?: number;
};

export type ChatUiMessage = ChatMessage & {
  id: string;
  createdAt: number;
  retrievalEvents?: ChatRetrievalEvent[];
  toolEvents?: ChatToolEvent[];
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
};
