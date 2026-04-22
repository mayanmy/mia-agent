import { request } from "../../shared/api/client";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatCompletionPayload = {
  agentId: string;
  message: string;
  history: ChatMessage[];
};

export type ChatCompletionResult = {
  agentId: string;
  modelConfigId: string;
  modelName: string;
  providerName: string;
  content: string;
};

export function createChatCompletion(
  payload: ChatCompletionPayload
): Promise<ChatCompletionResult> {
  return request<ChatCompletionResult>("/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
