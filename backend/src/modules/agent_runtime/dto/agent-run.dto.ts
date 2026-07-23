import { AgentRunSource } from "@prisma/client";

export type AgentRuntimeImageInput = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type AgentRuntimeFileInput = {
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

export type AgentRuntimeHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentRunRequest = {
  requestId: string;
  source: AgentRunSource;
  agentId: string;
  userId?: string;
  sessionId?: string;
  externalConversationId?: string;
  message: {
    text: string;
    images?: AgentRuntimeImageInput[];
    files?: AgentRuntimeFileInput[];
  };
  history: AgentRuntimeHistoryMessage[];
  signal?: AbortSignal;
};
