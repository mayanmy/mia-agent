import { AgentRunSource, AgentRunStatus } from "@prisma/client";

export type CreateAgentRunDto = {
  requestId: string;
  source: AgentRunSource;
  agentId: string;
  userId?: string;
  sessionId?: string;
  externalConversationId?: string;
  inputPreview: string;
};

export type AgentRunContext = {
  runId: string;
  requestId: string;
  status: AgentRunStatus;
};

export type CompleteAgentRunDto = {
  outputPreview: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
};

export type AgentRunErrorDto = {
  type: string;
  message: string;
};
