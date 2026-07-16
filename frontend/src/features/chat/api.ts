import { fetchWithAuth, request } from "../../shared/api/client";

export type ChatRole = "user" | "assistant";

export type ChatImageAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatFileAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
};

export type ChatCompletionPayload = {
  agentId: string;
  sessionId?: string;
  message: string;
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  history: ChatMessage[];
};

export type ChatSessionMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatSessionResponse = {
  mode: "EPHEMERAL" | "PERSISTENT";
  sessionId: string | null;
  messages: ChatSessionMessage[];
};

export type ChatSessionStatus = "ACTIVE" | "ARCHIVED";

export type ChatSessionListItem = {
  id: string;
  agentId: string;
  title: string;
  status: ChatSessionStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListResponse = {
  list: ChatSessionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ChatSessionMessagePage = {
  list: ChatSessionMessage[];
  nextBefore: string | null;
  hasMore: boolean;
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

export type ChatRetrievalSource = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
  contentPreview?: string;
};

export type ChatStreamEventType =
  | "message_start"
  | "retrieval_start"
  | "retrieval_result"
  | "token"
  | "tool_call"
  | "tool_result"
  | "message_end"
  | "error"
  | "ping";

export type ChatStreamEvent = {
  type: ChatStreamEventType;
  data: {
    knowledgeBaseIds?: string[];
    sources?: ChatRetrievalSource[];
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    toolId?: string;
    ok?: boolean;
    output?: unknown;
    errorType?: string;
    errorMessage?: string;
    elapsedMs?: number;
    content?: string;
    message?: string;
    agentId?: string;
    modelConfigId?: string;
    modelName?: string;
    providerName?: string;
    sessionId?: string;
  };
};

/** 获取当前成员在保留型 Agent 下的个人会话；单次模式会返回空会话。 */
export function getChatSession(agentId: string): Promise<ChatSessionResponse> {
  return request<ChatSessionResponse>(`/api/v1/chat/sessions/${agentId}`);
}

/** 读取一个保留型 Agent 的活跃会话列表；列表与消息都采用 Cursor，避免深页 Offset 扫描。 */
export function listChatSessions(
  agentId: string,
  options: { cursor?: string; pageSize?: number } = {}
): Promise<ChatSessionListResponse> {
  const params = new URLSearchParams({
    agentId,
    pageSize: String(options.pageSize ?? 30)
  });

  if (options.cursor) {
    params.set("cursor", options.cursor);
  }

  return request<ChatSessionListResponse>(`/api/v1/chat/sessions?${params.toString()}`);
}

/** 创建独立会话，新窗口不会复用旧消息作为模型上下文。 */
export function createChatSession(agentId: string): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>("/api/v1/chat/sessions", {
    method: "POST",
    body: JSON.stringify({ agentId })
  });
}

export function getChatSessionMessages(
  sessionId: string,
  options: { before?: string; pageSize?: number } = {}
): Promise<ChatSessionMessagePage> {
  const params = new URLSearchParams({ pageSize: String(options.pageSize ?? 50) });

  if (options.before) {
    params.set("before", options.before);
  }

  return request<ChatSessionMessagePage>(
    `/api/v1/chat/sessions/${sessionId}/messages?${params.toString()}`
  );
}

export function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>(`/api/v1/chat/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

export function archiveChatSession(sessionId: string): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>(`/api/v1/chat/sessions/${sessionId}/archive`, {
    method: "POST"
  });
}

export function createChatCompletion(
  payload: ChatCompletionPayload
): Promise<ChatCompletionResult> {
  return request<ChatCompletionResult>("/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function streamChatCompletion(
  payload: ChatCompletionPayload,
  options: {
    signal?: AbortSignal;
    onEvent: (event: ChatStreamEvent) => void;
  }
): Promise<void> {
  const response = await fetchWithAuth("/api/v1/chat/stream", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options.signal
  });

  if (!response.body) {
    throw new Error("流式对话请求失败");
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/u);
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const event = parseSseEvent(rawEvent);

      if (event) {
        options.onEvent(event);
      }
    }
  }

  reader.releaseLock();

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);

    if (event) {
      options.onEvent(event);
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const result = (await response.json()) as { message?: string };
    return result.message || "流式对话请求失败";
  } catch {
    return "流式对话请求失败";
  }
}

function parseSseEvent(rawEvent: string): ChatStreamEvent | null {
  const lines = rawEvent.split(/\r?\n/u);
  const eventTypeLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const type = eventTypeLine?.slice("event:".length).trim() as ChatStreamEventType | undefined;
  const dataText = dataLines.map((line) => line.slice("data:".length).trim()).join("\n");

  if (!type) {
    return null;
  }

  try {
    return {
      type,
      data: dataText ? JSON.parse(dataText) : {}
    };
  } catch {
    return {
      type: "error",
      data: {
        message: "流式响应解析失败"
      }
    };
  }
}
