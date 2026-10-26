import { AgentRunSource, AgentRuntimeMode } from "@prisma/client";

/** Runtime 接收的内联图片输入。 */
export type AgentRuntimeImageInput = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

/** Runtime 接收的已提取文本文件输入。 */
export type AgentRuntimeFileInput = {
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

/** 进入模型上下文的标准历史消息。 */
export type AgentRuntimeHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Chat、公开访问和 Workflow 入口调用 Agent Runtime 的统一请求。 */
export type AgentRunRequest = {
  requestId: string;
  source: AgentRunSource;
  agentId: string;
  /** Chat 已解析出的版本选择，避免会话准备与 Runtime 执行读取到不同发布指针。 */
  agentVersionId?: string;
  runtimeMode?: AgentRuntimeMode;
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
