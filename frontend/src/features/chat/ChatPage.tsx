import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App as AntdApp, Empty, Select, Tag } from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import {
  streamChatCompletion,
  type ChatFileAttachment,
  type ChatImageAttachment
} from "./api";
import { ChatComposer } from "./components/ChatComposer";
import { ChatHeader } from "./components/ChatHeader";
import { ChatTranscript } from "./components/ChatTranscript";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useChatAttachments } from "./hooks/useChatAttachments";
import type { ChatToolEvent, ChatUiMessage } from "./types";
import { createMessageId, findLastToolEventIndex, isLikelyVisionModel } from "./utils";

export function ChatPage() {
  const { message: messageApi } = AntdApp.useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get("agentId") || "");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [sending, setSending] = useState(false);
  const {
    images,
    files,
    handleBeforeUpload,
    handlePaste,
    handleFileBeforeUpload,
    removeImage,
    removeFile,
    clearAttachments
  } = useChatAttachments(messageApi);
  const {
    messagesRef,
    showScrollBottom,
    releaseAutoScrollIfNeeded,
    scrollMessagesToBottom,
    resetAutoScroll
  } = useAutoScroll([messages, sending]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const sendButtonDisabled =
    !sending &&
    (!selectedAgentId || (!input.trim() && images.length === 0 && files.length === 0));

  useEffect(() => {
    void refreshAgents();
  }, []);

  async function refreshAgents() {
    setLoadingAgents(true);

    try {
      const page = await listAgents(1, 100);
      const enabledAgents = page.list.filter((agent) => agent.enabled);
      const nextAgentId = searchParams.get("agentId") || selectedAgentId || enabledAgents[0]?.id || "";

      setAgents(enabledAgents);
      setSelectedAgentId(nextAgentId);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载 Agent 失败");
    } finally {
      setLoadingAgents(false);
    }
  }

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId);
    setMessages([]);
    resetAutoScroll();

    if (agentId) {
      setSearchParams({ agentId });
    } else {
      setSearchParams({});
    }
  }

  async function handleSend() {
    const content = input.trim();

    if (!selectedAgentId) {
      messageApi.warning("请选择 Agent");
      return;
    }

    if (!content && images.length === 0 && files.length === 0) {
      return;
    }

    if (images.length > 0 && selectedAgent && !isLikelyVisionModel(selectedAgent.modelName)) {
      messageApi.warning(
        `当前模型 ${selectedAgent.modelName} 不支持图片输入，请切换到 qwen-vl-max、qwen2.5-vl 等视觉模型。`
      );
      return;
    }

    const currentImages = images.map(({ name, mimeType, dataUrl }) => ({
      name,
      mimeType,
      dataUrl
    }));
    const currentFiles = files.map(({ name, mimeType, size, content: fileContent }) => ({
      name,
      mimeType,
      size,
      content: fileContent
    }));
    const nextUserMessage: ChatUiMessage = {
      id: createMessageId(),
      role: "user",
      content,
      images: currentImages,
      files: currentFiles,
      createdAt: Date.now()
    };
    const assistantMessageId = createMessageId();
    const history = messages.map(({ role, content: messageContent }) => ({
      role,
      content: messageContent
    }));

    resetAutoScroll();
    setMessages((current) => [
      ...current,
      nextUserMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: Date.now()
      }
    ]);
    setInput("");
    clearAttachments();
    setSending(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamChatCompletion(
        {
          agentId: selectedAgentId,
          message: content,
          images: currentImages,
          files: currentFiles,
          history
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "token" && event.data.content) {
              appendAssistantToken(assistantMessageId, event.data.content);
            }

            if (event.type === "tool_call") {
              appendToolCall(assistantMessageId, {
                id: event.data.id || createMessageId(),
                name: event.data.name || "unknown_tool",
                arguments: event.data.arguments,
                status: "running"
              });
            }

            if (event.type === "tool_result") {
              updateToolResult(assistantMessageId, {
                toolId: event.data.toolId || "",
                ok: Boolean(event.data.ok),
                output: event.data.output,
                errorMessage: event.data.errorMessage,
                elapsedMs: event.data.elapsedMs
              });
            }

            if (event.type === "error") {
              throw new Error(event.data.message || "对话失败");
            }
          }
        }
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        appendAssistantToken(assistantMessageId, "\n\n已停止生成。");
      } else {
        messageApi.error(error instanceof Error ? error.message : "对话失败");
        removeAssistantMessageIfEmpty(assistantMessageId);
      }
    } finally {
      abortControllerRef.current = null;
      setSending(false);
    }
  }

  function appendAssistantToken(messageId: string, token: string) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              content: `${item.content}${token}`
            }
          : item
      )
    );
  }

  function appendToolCall(messageId: string, toolEvent: ChatToolEvent) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              toolEvents: [...(item.toolEvents ?? []), toolEvent]
            }
          : item
      )
    );
  }

  function updateToolResult(
    messageId: string,
    result: {
      toolId: string;
      ok: boolean;
      output?: unknown;
      errorMessage?: string;
      elapsedMs?: number;
    }
  ) {
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== messageId || !item.toolEvents?.length) {
          return item;
        }

        const index = findLastToolEventIndex(item.toolEvents, result.toolId);

        if (index < 0) {
          return item;
        }

        return {
          ...item,
          toolEvents: item.toolEvents.map((toolEvent, currentIndex) =>
            currentIndex === index
              ? {
                  ...toolEvent,
                  status: result.ok ? "success" : "error",
                  output: result.output,
                  errorMessage: result.errorMessage,
                  elapsedMs: result.elapsedMs
                }
              : toolEvent
          )
        };
      })
    );
  }

  function removeAssistantMessageIfEmpty(messageId: string) {
    setMessages((current) =>
      current.filter((item) => item.id !== messageId || item.content.trim().length > 0)
    );
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  async function copyMessageContent(content: string) {
    if (!content.trim()) {
      return;
    }

    await navigator.clipboard.writeText(content);
    messageApi.success("已复制");
  }

  return (
    <section className="workspace chatWorkspace">
      <ChatHeader loadingAgents={loadingAgents} onRefreshAgents={() => void refreshAgents()} />

      <div className="chatLayout">
        <aside className="chatSide panel">
          <div className="panelHeader">
            <h2>Agent</h2>
          </div>
          <div className="chatSideBody">
            <Select
              className="chatAgentSelect"
              loading={loadingAgents}
              options={agents.map((agent) => ({
                label: `${agent.name} · ${agent.providerName} / ${agent.modelName}`,
                value: agent.id
              }))}
              placeholder="请选择 Agent"
              value={selectedAgentId || undefined}
              onChange={handleAgentChange}
            />
            {selectedAgent ? (
              <div className="chatAgentMeta">
                <div className="chatAgentName">{selectedAgent.name}</div>
                <div className="chatAgentModel">
                  {selectedAgent.providerName} / {selectedAgent.modelName}
                </div>
                <Tag color="green">已启用</Tag>
              </div>
            ) : (
              <Empty description="暂无可用 Agent" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </div>
        </aside>

        <div className="chatPanel panel">
          <ChatTranscript
            messages={messages}
            messagesRef={messagesRef}
            sending={sending}
            showScrollBottom={showScrollBottom}
            onCopyMessage={(content) => void copyMessageContent(content)}
            onScroll={releaseAutoScrollIfNeeded}
            onScrollBottom={scrollMessagesToBottom}
          />
          <ChatComposer
            files={files}
            images={images}
            input={input}
            selectedAgentId={selectedAgentId}
            sendButtonDisabled={sendButtonDisabled}
            sending={sending}
            onFileBeforeUpload={handleFileBeforeUpload}
            onImageBeforeUpload={handleBeforeUpload}
            onInputChange={setInput}
            onPaste={handlePaste}
            onRemoveFile={removeFile}
            onRemoveImage={removeImage}
            onSend={() => void handleSend()}
            onStop={handleStop}
          />
        </div>
      </div>
    </section>
  );
}
