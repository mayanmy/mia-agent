import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App as AntdApp, Empty, Select, Tag } from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import { getChatSession, streamChatCompletion } from "./api";
import { ChatComposer } from "./components/ChatComposer";
import { ChatHeader } from "./components/ChatHeader";
import { ChatTranscript } from "./components/ChatTranscript";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useChatAttachments } from "./hooks/useChatAttachments";
import type { ChatRetrievalEvent, ChatToolEvent, ChatUiMessage } from "./types";
import { createMessageId, findLastToolEventIndex, isLikelyVisionModel } from "./utils";
import "./chat.less";

export function ChatPage() {
  const { message: messageApi } = AntdApp.useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const disposedRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get("agentId") || "");
  const [sessionId, setSessionId] = useState<string | null>(null);
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

  useEffect(() => {
    let disposed = false;
    const sessionMode = selectedAgent?.chatSessionMode;

    // 切换 Agent 时先停止旧流，避免旧 Agent 的 token 混入新 Agent 恢复出的会话。
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
    setSessionId(null);
    setMessages([]);
    resetAutoScroll();

    if (!selectedAgentId || sessionMode !== "PERSISTENT") {
      return () => {
        disposed = true;
      };
    }

    void getChatSession(selectedAgentId)
      .then((session) => {
        if (disposed) {
          return;
        }

        setSessionId(session.sessionId);
        setMessages(
          session.messages.map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            createdAt: new Date(item.createdAt).getTime()
          }))
        );
        resetAutoScroll();
      })
      .catch((error) => {
        if (!disposed) {
          messageApi.error(error instanceof Error ? error.message : "恢复历史对话失败");
        }
      });

    return () => {
      disposed = true;
    };
  }, [messageApi, resetAutoScroll, selectedAgent?.chatSessionMode, selectedAgentId]);
  const sendButtonDisabled =
    !sending && (!selectedAgentId || (!input.trim() && images.length === 0 && files.length === 0));

  useEffect(() => {
    let disposed = false;
    // StrictMode 会执行一次 setup -> cleanup -> setup；每次 setup 都要恢复当前实例的可用状态。
    disposedRef.current = false;
    void refreshAgents(() => !disposed);

    return () => {
      disposed = true;
      disposedRef.current = true;
      // 页面离开时必须中断 SSE，避免后端继续生成并让旧回调写入已销毁的对话界面。
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  async function refreshAgents(isActive: () => boolean = () => true) {
    if (!isActive()) {
      return;
    }

    setLoadingAgents(true);

    try {
      const page = await listAgents(1, 100);
      const enabledAgents = page.list.filter((agent) => agent.enabled);
      const nextAgentId =
        searchParams.get("agentId") || selectedAgentId || enabledAgents[0]?.id || "";

      if (isActive()) {
        setAgents(enabledAgents);
        setSelectedAgentId(nextAgentId);
      }
    } catch (error) {
      if (isActive()) {
        messageApi.error(error instanceof Error ? error.message : "加载 Agent 失败");
      }
    } finally {
      if (isActive()) {
        setLoadingAgents(false);
      }
    }
  }

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId);

    if (agentId) {
      setSearchParams({ agentId });
    } else {
      setSearchParams({});
    }
  }

  async function handleSend() {
    if (disposedRef.current) {
      return;
    }

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
          sessionId: sessionId ?? undefined,
          message: content,
          images: currentImages,
          files: currentFiles,
          history
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            // Abort 后仍可能有一个已经排队的 SSE 事件到达，不能让它更新已停止或已卸载的页面。
            if (disposedRef.current || controller.signal.aborted) {
              return;
            }

            if (event.type === "token" && event.data.content) {
              appendAssistantToken(assistantMessageId, event.data.content);
            }

            if (event.type === "message_start" && event.data.sessionId) {
              setSessionId(event.data.sessionId);
            }

            if (event.type === "retrieval_start") {
              appendRetrievalEvent(assistantMessageId, {
                id: createMessageId(),
                knowledgeBaseIds: event.data.knowledgeBaseIds ?? [],
                status: "running",
                sources: []
              });
            }

            if (event.type === "retrieval_result") {
              updateRetrievalResult(assistantMessageId, {
                elapsedMs: event.data.elapsedMs,
                sources: event.data.sources ?? []
              });
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
                errorType: event.data.errorType,
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
        if (!disposedRef.current) {
          appendAssistantToken(assistantMessageId, "\n\n已停止生成。");
        }
      } else if (!disposedRef.current) {
        messageApi.error(error instanceof Error ? error.message : "对话失败");
        removeAssistantMessageIfEmpty(assistantMessageId);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      if (!disposedRef.current) {
        setSending(false);
      }
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

  function appendRetrievalEvent(messageId: string, retrievalEvent: ChatRetrievalEvent) {
    setMessages((current) =>
      current.map((item) =>
        item.id === messageId
          ? {
              ...item,
              retrievalEvents: [...(item.retrievalEvents ?? []), retrievalEvent]
            }
          : item
      )
    );
  }

  function updateRetrievalResult(
    messageId: string,
    result: Pick<ChatRetrievalEvent, "elapsedMs" | "sources">
  ) {
    setMessages((current) =>
      current.map((item) => {
        if (item.id !== messageId || !item.retrievalEvents?.length) {
          return item;
        }

        // 每轮对话只有一个检索事件，仍按最后一个更新，便于后续支持多次检索。
        const lastIndex = item.retrievalEvents.length - 1;

        return {
          ...item,
          retrievalEvents: item.retrievalEvents.map((retrievalEvent, index) =>
            index === lastIndex
              ? {
                  ...retrievalEvent,
                  status: "success",
                  sources: result.sources,
                  elapsedMs: result.elapsedMs
                }
              : retrievalEvent
          )
        };
      })
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
      errorType?: string;
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
                  errorType: result.errorType,
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
      current.filter(
        (item) =>
          item.id !== messageId ||
          item.content.trim().length > 0 ||
          Boolean(item.retrievalEvents?.length) ||
          Boolean(item.toolEvents?.length)
      )
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
                <div className="chatAgentBindings">
                  <span>知识库 {selectedAgent.knowledgeBaseCount}</span>
                  <span>工具 {selectedAgent.toolCount}</span>
                </div>
                <div className="chatAgentStatus">
                  <Tag color="green">已启用</Tag>
                  <Tag color={selectedAgent.chatSessionMode === "PERSISTENT" ? "blue" : "default"}>
                    {selectedAgent.chatSessionMode === "PERSISTENT" ? "保留会话" : "单次会话"}
                  </Tag>
                </div>
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
