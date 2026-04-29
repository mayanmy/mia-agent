import { request } from "../../shared/api/client";

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
  message: string;
  images: ChatImageAttachment[];
  files: ChatFileAttachment[];
  history: ChatMessage[];
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

export type ChatStreamEventType = "message_start" | "token" | "message_end" | "error" | "ping";

export type ChatStreamEvent = {
  type: ChatStreamEventType;
  data: {
    content?: string;
    message?: string;
    agentId?: string;
    modelConfigId?: string;
    modelName?: string;
    providerName?: string;
  };
};

export function createChatCompletion(
  payload: ChatCompletionPayload
): Promise<ChatCompletionResult> {
  return request<ChatCompletionResult>("/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

export async function streamChatCompletion(
  payload: ChatCompletionPayload,
  options: {
    signal?: AbortSignal;
    onEvent: (event: ChatStreamEvent) => void;
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/api/v1/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
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
