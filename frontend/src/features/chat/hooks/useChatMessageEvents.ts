import type { Dispatch, SetStateAction } from "react";

import type { ChatRetrievalEvent, ChatToolEvent, ChatUiMessage } from "../types";
import { findLastToolEventIndex } from "../utils";

/** 集中处理 SSE 事件对消息视图模型的归并，避免路由页承载大量不可复用的数组更新。 */
export function useChatMessageEvents(
  setMessages: Dispatch<SetStateAction<ChatUiMessage[]>>
) {
  const update = (messageId: string, transform: (item: ChatUiMessage) => ChatUiMessage) =>
    setMessages((current) =>
      current.map((item) => (item.id === messageId ? transform(item) : item))
    );

  return {
    appendAssistantToken: (messageId: string, token: string) =>
      update(messageId, (item) => ({ ...item, content: `${item.content}${token}` })),
    replaceAssistantContent: (messageId: string, content: string) =>
      update(messageId, (item) => ({ ...item, content })),
    updateAssistantGeneration: (
      messageId: string,
      generationStatus: NonNullable<ChatUiMessage["generationStatus"]>,
      errorMessage?: string
    ) => update(messageId, (item) => ({ ...item, generationStatus, errorMessage })),
    updateAssistantRuntimeMetadata: (
      messageId: string,
      metadata: NonNullable<ChatUiMessage["runtimeMetadata"]>
    ) =>
      update(messageId, (item) => ({
        ...item,
        runtimeMetadata: { ...item.runtimeMetadata, ...metadata }
      })),
    updateAssistantPersistedId: (messageId: string, persistedMessageId: string) =>
      update(messageId, (item) => ({ ...item, persistedMessageId })),
    appendRetrievalEvent: (messageId: string, event: ChatRetrievalEvent) =>
      update(messageId, (item) => ({
        ...item,
        retrievalEvents: [...(item.retrievalEvents ?? []), event]
      })),
    updateRetrievalResult: (
      messageId: string,
      result: Pick<ChatRetrievalEvent, "elapsedMs" | "sources">
    ) =>
      update(messageId, (item) => {
        if (!item.retrievalEvents?.length) return item;
        const lastIndex = item.retrievalEvents.length - 1;
        return {
          ...item,
          retrievalEvents: item.retrievalEvents.map((event, index) =>
            index === lastIndex ? { ...event, status: "success", ...result } : event
          )
        };
      }),
    appendToolCall: (messageId: string, event: ChatToolEvent) =>
      update(messageId, (item) => ({
        ...item,
        toolEvents: [...(item.toolEvents ?? []), event]
      })),
    updateToolResult: (
      messageId: string,
      result: {
        toolId: string;
        ok: boolean;
        output?: unknown;
        errorType?: string;
        errorMessage?: string;
        elapsedMs?: number;
      }
    ) =>
      update(messageId, (item) => {
        if (!item.toolEvents?.length) return item;
        const index = findLastToolEventIndex(item.toolEvents, result.toolId);
        if (index < 0) return item;
        return {
          ...item,
          toolEvents: item.toolEvents.map((event, currentIndex) =>
            currentIndex === index
              ? {
                  ...event,
                  status: result.ok ? "success" : "error",
                  output: result.output,
                  errorType: result.errorType,
                  errorMessage: result.errorMessage,
                  elapsedMs: result.elapsedMs
                }
              : event
          )
        };
      }),
    updateToolApproval: (
      messageId: string,
      approval: { toolCallId: string; approvalId: string; expiresAt?: string }
    ) =>
      update(messageId, (item) => ({
        ...item,
        toolEvents: item.toolEvents?.map((event) =>
          event.id === approval.toolCallId
            ? {
                ...event,
                status: "approval_required",
                approvalId: approval.approvalId,
                approvalExpiresAt: approval.expiresAt
              }
            : event
        )
      })),
    resolveToolApproval: (messageId: string, toolCallId: string) =>
      update(messageId, (item) => ({
        ...item,
        toolEvents: item.toolEvents?.map((event) =>
          event.id === toolCallId ? { ...event, status: "running" } : event
        )
      }))
  };
}
