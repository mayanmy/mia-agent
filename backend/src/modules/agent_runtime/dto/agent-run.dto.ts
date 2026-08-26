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
  /** 仅登录成员的内部 Chat 可在同一条 SSE 中挂起并恢复 CONFIRM 工具。 */
  allowInteractiveToolApproval?: boolean;
  signal?: AbortSignal;
};
