import { fetchWithAuth, request } from "../../shared/api/client";

/** Chat 当前支持的消息角色。 */
export type ChatRole = "user" | "assistant";

/** 浏览器侧图片附件；id 仅用于本地列表稳定渲染。 */
export type ChatImageAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

/** 浏览器侧文本文件附件，content 保存提交给后端的文本内容。 */
export type ChatFileAttachment = {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  content: string;
};

/** 可进入对话历史的标准消息。 */
export type ChatMessage = {
  role: ChatRole;
  content: string;
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
};

/** 发起对话补全时提交给 API 的完整载荷。 */
export type ChatCompletionPayload = {
  agentId: string;
  sessionId?: string;
  message: string;
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  history: ChatMessage[];
};

/** 服务端持久化并返回的会话消息。 */
export type ChatSessionMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

/** 兼容旧单会话接口的响应结构。 */
export type ChatSessionResponse = {
  mode: "EPHEMERAL" | "PERSISTENT";
  sessionId: string | null;
  messages: ChatSessionMessage[];
};

/** 持久会话的生命周期状态。 */
export type ChatSessionStatus = "ACTIVE" | "ARCHIVED";

/** 会话侧栏使用的列表项摘要。 */
export type ChatSessionListItem = {
  id: string;
  agentId: string;
  title: string;
  status: ChatSessionStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 一页会话列表及后续分页信息。 */
export type ChatSessionListResponse = {
  list: ChatSessionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** 向前加载历史消息时返回的一页数据。 */
export type ChatSessionMessagePage = {
  list: ChatSessionMessage[];
  nextBefore: string | null;
  hasMore: boolean;
};

/** 非流式对话完成后的模型与内容摘要。 */
export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

/** RAG 检索命中的可展示来源。 */
export type ChatRetrievalSource = {
  knowledgeBaseId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
  contentPreview?: string;
};

/** 与后端约定一致的 Chat SSE 事件名称。 */
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

/** 浏览器消费的 SSE 事件；data 汇总各事件可能携带的字段。 */
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
  options: { cursor?: string; pageSize?: number; status?: ChatSessionStatus } = {}
): Promise<ChatSessionListResponse> {
  const params = new URLSearchParams({
    agentId,
    pageSize: String(options.pageSize ?? 30)
  });

  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.status) {
    params.set("status", options.status);
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

/** 分页读取指定会话的历史消息。 */
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

/** 更新会话标题，并返回刷新后的列表摘要。 */
export function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>(`/api/v1/chat/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

/** 将活跃会话移入归档区，保留其中的消息。 */
export function archiveChatSession(sessionId: string): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>(`/api/v1/chat/sessions/${sessionId}/archive`, {
    method: "POST"
  });
}

/** 恢复后会话重新出现在默认历史列表，并允许继续发送消息。 */
export function restoreChatSession(sessionId: string): Promise<ChatSessionListItem> {
  return request<ChatSessionListItem>(`/api/v1/chat/sessions/${sessionId}/restore`, {
    method: "POST"
  });
}

/** 删除仅适用于已归档会话，消息会随会话一起永久清理。 */
export function deleteChatSession(sessionId: string): Promise<null> {
  return request<null>(`/api/v1/chat/sessions/${sessionId}`, {
    method: "DELETE"
  });
}

/** 发起非流式对话，主要供无需逐 token 展示的调用方使用。 */
export function createChatCompletion(
  payload: ChatCompletionPayload
): Promise<ChatCompletionResult> {
  return request<ChatCompletionResult>("/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * 消费 Chat SSE 字节流并逐事件回调。
 * 分块边界不保证与事件边界一致，因此使用 buffer 保留尚未接收完整的尾部事件。
 */
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

/** 尽量读取后端统一错误消息，响应体异常时回退到稳定文案。 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const result = (await response.json()) as { message?: string };
    return result.message || "流式对话请求失败";
  } catch {
    return "流式对话请求失败";
  }
}

/** 将单个 SSE 文本块解析为前端事件；畸形 JSON 会转换为可展示的 error 事件。 */
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
