import { fetchWithAuth, request } from "../../shared/api/client";

/** Chat 当前支持的消息角色。 */
export type ChatRole = "user" | "assistant";

export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown; title?: string }
  | {
      type: "image";
      fileId: string;
      name: string;
      mimeType: string;
      size: number;
      url: string;
      alt?: string;
      width?: number;
      height?: number;
    }
  | { type: "file"; fileId: string; name: string; mimeType: string; size: number; url: string };

/** 浏览器侧图片附件；id 仅用于本地列表稳定渲染。 */
export type ChatImageAttachment = {
  /** 浏览器侧列表渲染 ID。 */
  id?: string;
  /** 原始文件名。 */
  name: string;
  /** 图片 MIME 类型。 */
  mimeType: string;
  /** 图片预览及提交使用的 Data URL。 */
  dataUrl: string;
};

/** 浏览器侧文本文件附件，content 保存提交给后端的文本内容。 */
export type ChatFileAttachment = {
  /** 浏览器侧列表渲染 ID。 */
  id?: string;
  /** 原始文件名。 */
  name: string;
  /** 文件 MIME 类型。 */
  mimeType: string;
  /** 文件字节数。 */
  size: number;
  /** 已读取的纯文本内容。 */
  content: string;
};

/** 可进入对话历史的标准消息。 */
export type ChatMessage = {
  /** 消息发送方。 */
  role: ChatRole;
  /** 消息文本正文。 */
  content: string;
  contentParts?: AgentContentPart[];
  /** 可选图片附件。 */
  images?: ChatImageAttachment[];
  /** 可选文本附件。 */
  files?: ChatFileAttachment[];
};

/** 发起对话补全时提交给 API 的完整载荷。 */
export type ChatCompletionPayload = {
  /** 要运行的 Agent ID。 */
  agentId: string;
  /** 持久会话 ID；临时模式不传。 */
  sessionId?: string;
  /** 本轮用户输入。 */
  message: string;
  /** 本轮图片附件。 */
  images: ChatImageAttachment[];
  /** 本轮文本附件。 */
  files: ChatFileAttachment[];
  /** 仅临时会话提交的受限上下文历史；保留会话由后端按 sessionId 读取。 */
  history?: ChatMessage[];
};

/** 服务端持久化并返回的会话消息。 */
export type ChatSessionMessage = {
  /** 服务端消息 ID。 */
  id: string;
  /** 消息发送方。 */
  role: ChatRole;
  /** 消息正文。 */
  content: string;
  contentParts: AgentContentPart[];
  /** assistant 回答的运行快照；旧消息和用户消息为 null。 */
  metadata: ChatMessageMetadata | null;
  feedback: ChatMessageFeedback | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
};

/** 当前成员对 Assistant 消息保存的反馈。 */
export type ChatMessageFeedback = {
  messageId: string;
  rating: "UP" | "DOWN";
  reason: string | null;
};

/** 持久消息附带的运行、检索与工具事件快照。 */
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
    sources: ChatRetrievalSource[];
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

/** 兼容旧单会话接口的响应结构。 */
export type ChatSessionResponse = {
  /** Agent 的会话模式。 */
  mode: "EPHEMERAL" | "PERSISTENT";
  /** 当前持久会话 ID；临时模式为 null。 */
  sessionId: string | null;
  /** 当前会话历史消息。 */
  messages: ChatSessionMessage[];
};

/** 持久会话的生命周期状态。 */
export type ChatSessionStatus = "ACTIVE" | "ARCHIVED";

/** 会话侧栏使用的列表项摘要。 */
export type ChatSessionListItem = {
  /** 会话 ID。 */
  id: string;
  /** 所属 Agent ID。 */
  agentId: string;
  /** 会话标题。 */
  title: string;
  /** 会话生命周期状态。 */
  status: ChatSessionStatus;
  /** 最近消息时间；空会话为 null。 */
  lastMessageAt: string | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
  /** ISO 格式更新时间。 */
  updatedAt: string;
};

/** 一页会话列表及后续分页信息。 */
export type ChatSessionListResponse = {
  /** 当前页会话。 */
  list: ChatSessionListItem[];
  /** 下一页游标。 */
  nextCursor: string | null;
  /** 是否仍有后续会话。 */
  hasMore: boolean;
};

/** 向前加载历史消息时返回的一页数据。 */
export type ChatSessionMessagePage = {
  /** 当前页消息。 */
  list: ChatSessionMessage[];
  /** 继续加载更早消息的游标。 */
  nextBefore: string | null;
  /** 是否仍有更早消息。 */
  hasMore: boolean;
};

/** 非流式对话完成后的模型与内容摘要。 */
export type ChatCompletionResult = {
  /** 实际运行的 Agent ID。 */
  agentId: string;
  /** 实际模型配置 ID。 */
  modelConfigId: string;
  /** 实际模型名称。 */
  modelName: string;
  /** 实际供应商名称。 */
  providerName: string;
  /** 最终生成正文。 */
  content: string;
  contentParts: AgentContentPart[];
};

/** RAG 检索命中的可展示来源。 */
export type ChatRetrievalSource = {
  /** 来源知识库 ID。 */
  knowledgeBaseId: string;
  /** 来源文档 ID。 */
  documentId: string;
  /** 来源文档名称。 */
  documentName: string;
  /** 命中的 Chunk ID。 */
  chunkId: string;
  /** Chunk 在文档中的顺序。 */
  chunkIndex: number;
  /** 向量检索相关度分数。 */
  score: number;
  /** 可选内容摘要，避免前端接收完整 Chunk。 */
  contentPreview?: string;
};

/** 与后端约定一致的 Chat SSE 事件名称。 */
export type ChatStreamEventType =
  | "message_start"
  | "tool_search_start"
  | "tool_search_result"
  | "retrieval_start"
  | "retrieval_result"
  | "token"
  | "content_part"
  | "tool_call"
  | "tool_approval_required"
  | "tool_approval_resolved"
  | "tool_result"
  | "message_end"
  | "error"
  | "ping";

/** Chat SSE 各事件可能携带的字段集合。 */
export type ChatStreamEventData = {
  /** 检索开始时计划查询的知识库 ID。 */
  knowledgeBaseIds?: string[];
  /** Tool Search 前的绑定数量。 */
  boundToolCount?: number;
  /** Tool Catalog 当前可召回数量。 */
  catalogMatchCount?: number;
  /** 本轮真正注入模型的工具 ID。 */
  selectedToolIds?: string[];
  /** 检索完成后的来源列表。 */
  sources?: ChatRetrievalSource[];
  /** 工具调用或运行事件 ID。 */
  id?: string;
  /** 审批事件对应的模型工具调用 ID。 */
  toolCallId?: string;
  /** 工具注册名称。 */
  name?: string;
  /** 工具调用参数。 */
  arguments?: Record<string, unknown>;
  /** 与 tool_result 对应的工具调用 ID。 */
  toolId?: string;
  /** CONFIRM 工具的一次性审批 ID。 */
  approvalId?: string;
  /** 审批有效期。 */
  expiresAt?: string;
  /** 审批是否通过。 */
  approved?: boolean;
  /** 审批状态。 */
  status?: string;
  /** 工具是否执行成功。 */
  ok?: boolean;
  /** 工具结构化输出。 */
  output?: unknown;
  /** 工具或运行错误分类。 */
  errorType?: string;
  /** 工具或运行错误说明。 */
  errorMessage?: string;
  /** 当前阶段耗时毫秒数。 */
  elapsedMs?: number;
  /** token 增量或最终消息正文。 */
  content?: string;
  /** message_end 的权威有序内容块，或 content_part 的单块增量。 */
  contentParts?: AgentContentPart[];
  part?: AgentContentPart;
  /** 面向用户的错误消息。 */
  message?: string;
  /** 实际运行的 Agent ID。 */
  agentId?: string;
  /** 实际模型配置 ID。 */
  modelConfigId?: string;
  /** 实际模型名称。 */
  modelName?: string;
  /** 实际供应商名称。 */
  providerName?: string;
  /** 服务端创建或确认的持久会话 ID。 */
  sessionId?: string;
  /** Runtime 运行记录 ID。 */
  runId?: string;
  /** 成功写入保留会话后的 Assistant 消息 ID。 */
  messageId?: string;
  /** 模型 token 用量。 */
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCost?: number };
};

/** 浏览器消费的单个 Chat SSE 事件。 */
export type ChatStreamEvent = {
  /** 服务端可恢复流中的递增游标；ping 等瞬时事件可以为空。 */
  eventId?: number;
  /** 决定 UI 状态流转方式的事件名称。 */
  type: ChatStreamEventType;
  /** 与事件类型对应的可选字段集合。 */
  data: ChatStreamEventData;
};

/** 会话列表分页选项。 */
export type ListChatSessionsOptions = {
  /** 下一页复合游标。 */
  cursor?: string;
  /** 每页会话数量。 */
  pageSize?: number;
  /** 活跃或归档状态筛选。 */
  status?: ChatSessionStatus;
};

/** 会话消息分页选项。 */
export type GetChatSessionMessagesOptions = {
  /** 加载更早消息的复合游标。 */
  before?: string;
  /** 每页消息数量。 */
  pageSize?: number;
};

/** 流式对话消费选项。 */
export type StreamChatCompletionOptions = {
  /** 用于停止读取并取消上游请求的信号。 */
  signal?: AbortSignal;
  /** 创建服务端生成任务后立即回传 ID，供用户停止和页面离开时主动取消。 */
  onStreamCreated?: (streamId: string) => void;
  /** 每解析出一个完整 SSE 事件时调用。 */
  onEvent: (event: ChatStreamEvent) => void;
};

type ChatStreamCreateResponse = {
  streamId: string;
  reconnectWindowMs: number;
};

/** 获取当前成员在保留型 Agent 下的个人会话；单次模式会返回空会话。 */
export function getChatSession(agentId: string): Promise<ChatSessionResponse> {
  return request<ChatSessionResponse>(`/api/v1/chat/sessions/${agentId}`);
}

/** 读取一个保留型 Agent 的活跃会话列表；列表与消息都采用 Cursor，避免深页 Offset 扫描。 */
export function listChatSessions(
  agentId: string,
  options: ListChatSessionsOptions = {}
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
  options: GetChatSessionMessagesOptions = {}
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

export function submitChatMessageFeedback(
  messageId: string,
  rating: "UP" | "DOWN",
  reason?: string
): Promise<ChatMessageFeedback> {
  return request<ChatMessageFeedback>(`/api/v1/chat/messages/${messageId}/feedback`, {
    method: "PUT",
    body: JSON.stringify({ rating, reason })
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

/** 批准当前登录成员自己的待执行 MCP 工具调用。 */
export function approveMcpToolCall(approvalId: string): Promise<unknown> {
  return request(`/api/v1/mcp/approvals/${approvalId}/approve`, { method: "POST" });
}

/** 拒绝工具调用后，原 SSE 会恢复并把拒绝结果送回模型。 */
export function rejectMcpToolCall(approvalId: string): Promise<unknown> {
  return request(`/api/v1/mcp/approvals/${approvalId}/reject`, { method: "POST" });
}

/**
 * 消费 Chat SSE 字节流并逐事件回调。
 * 分块边界不保证与事件边界一致，因此使用 buffer 保留尚未接收完整的尾部事件。
 */
export async function streamChatCompletion(
  payload: ChatCompletionPayload,
  options: StreamChatCompletionOptions
): Promise<void> {
  const stream = await request<ChatStreamCreateResponse>("/api/v1/chat/streams", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options.signal
  });
  options.onStreamCreated?.(stream.streamId);

  let lastEventId = 0;
  let completed = false;
  let retryAttempt = 0;
  const reconnectDeadline = Date.now() + stream.reconnectWindowMs;

  while (!completed && !options.signal?.aborted) {
    try {
      const response = await fetchWithAuth(
        `/api/v1/chat/streams/${encodeURIComponent(stream.streamId)}/events?after=${lastEventId}`,
        {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: options.signal
        }
      );

      if (!response.body) {
        throw new RetryableChatStreamError("流式对话响应为空");
      }

      if (!response.ok) {
        throw new NonRetryableChatStreamError(await readErrorMessage(response));
      }

      const result = await consumeChatEventStream(response.body, lastEventId, options);
      lastEventId = result.lastEventId;
      completed = result.completed;
      if (!completed) {
        throw new RetryableChatStreamError("流式连接已断开");
      }
      retryAttempt = 0;
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) throw error;
      if (error instanceof ChatStreamConsumerError) throw error.cause;
      if (error instanceof NonRetryableChatStreamError || Date.now() >= reconnectDeadline)
        throw error;

      const delayMs = Math.min(500 * 2 ** retryAttempt, 5_000);
      retryAttempt += 1;
      await waitForReconnect(delayMs, options.signal);
    }
  }
}

/** 用户主动停止或离开页面时取消服务端任务；网络波动不调用此接口。 */
export function cancelChatStream(streamId: string): Promise<null> {
  return request<null>(`/api/v1/chat/streams/${encodeURIComponent(streamId)}`, {
    method: "DELETE"
  });
}

async function consumeChatEventStream(
  body: ReadableStream<Uint8Array>,
  initialEventId: number,
  options: StreamChatCompletionOptions
): Promise<{ lastEventId: number; completed: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = initialEventId;
  let completed = false;

  const consumeRawEvent = (rawEvent: string) => {
    const event = parseSseEvent(rawEvent);
    if (!event) return;

    if (event.eventId !== undefined) {
      if (event.eventId <= lastEventId) return;
      lastEventId = event.eventId;
    }

    try {
      options.onEvent(event);
    } catch (error) {
      throw new ChatStreamConsumerError(error);
    }

    if (event.type === "message_end" || event.type === "error") completed = true;
  };

  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/u);
      buffer = events.pop() ?? "";
      for (const rawEvent of events) {
        consumeRawEvent(rawEvent);
        if (completed) break;
      }
    }
  } catch (error) {
    if (error instanceof ChatStreamConsumerError) throw error;
    if (isAbortError(error)) throw error;
    throw new RetryableChatStreamError(error instanceof Error ? error.message : "流式连接已断开");
  } finally {
    reader.releaseLock();
  }

  if (!completed && buffer.trim()) {
    consumeRawEvent(buffer);
  }

  return { lastEventId, completed };
}

class RetryableChatStreamError extends Error {}

class NonRetryableChatStreamError extends Error {}

class ChatStreamConsumerError extends Error {
  constructor(readonly cause: unknown) {
    super("chat stream consumer failed");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function waitForReconnect(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(done, delayMs);
    const abort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
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
  const eventIdLine = lines.find((line) => line.startsWith("id:"));
  const eventTypeLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const type = eventTypeLine?.slice("event:".length).trim() as ChatStreamEventType | undefined;
  const dataText = dataLines.map((line) => line.slice("data:".length).trim()).join("\n");

  if (!type) {
    return null;
  }

  try {
    const parsedEventId = eventIdLine ? Number(eventIdLine.slice("id:".length).trim()) : undefined;
    return {
      eventId:
        parsedEventId !== undefined && Number.isSafeInteger(parsedEventId)
          ? parsedEventId
          : undefined,
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
