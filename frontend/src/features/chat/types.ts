import type { ChatFileAttachment, ChatImageAttachment, ChatMessage } from "./api";

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

export type ChatUiMessage = ChatMessage & {
  id: string;
  createdAt: number;
  toolEvents?: ChatToolEvent[];
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
};
