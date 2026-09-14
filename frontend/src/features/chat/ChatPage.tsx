import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App as AntdApp, Input } from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import {
  archiveChatSession,
  createChatSession,
  deleteChatSession,
  getChatSessionMessages,
  listChatSessions,
  restoreChatSession,
  submitChatMessageFeedback,
  streamChatCompletion,
  updateChatSessionTitle,
  type ChatSessionListItem,
  type ChatSessionStatus
} from "./api";
import { ChatComposer } from "./components/ChatComposer";
import { ChatAgentGallery } from "./components/ChatAgentGallery";
import { ChatHeader } from "./components/ChatHeader";
import { ChatSessionList } from "./components/ChatSessionList";
import { ChatTranscript } from "./components/ChatTranscript";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useChatAttachments } from "./hooks/useChatAttachments";
import { useChatMessageEvents } from "./hooks/useChatMessageEvents";
import { buildTransportHistory } from "./history";
import type { ChatUiMessage } from "./types";
import { createMessageId, isLikelyVisionModel } from "./utils";
import "./chat.less";

/** Chat 路由页，负责编排 Agent、会话、附件与 SSE 状态。 */
export function ChatPage() {
  const { message: messageApi, modal } = AntdApp.useApp();
  const navigate = useNavigate();
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamStartedAtRef = useRef<Map<string, number>>(new Map());
  const firstTokenRecordedRef = useRef<Set<string>>(new Set());
  const disposedRef = useRef(false);
  const sessionLoadVersionRef = useRef(0);
  const historyLoadVersionRef = useRef(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  // URL 是详情选择的唯一事实来源；浏览器前进/后退更新查询参数后，页面会随之重新渲染。
  const selectedAgentId = searchParams.get("agentId") || "";
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<ChatSessionStatus>("ACTIVE");
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([]);
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const {
    appendAssistantToken,
    replaceAssistantContent,
    updateAssistantGeneration,
    updateAssistantRuntimeMetadata,
    updateAssistantPersistedId,
    appendRetrievalEvent,
    updateRetrievalResult,
    appendToolCall,
    updateToolResult,
    updateToolApproval,
    resolveToolApproval
  } = useChatMessageEvents(setMessages);
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
    const requestVersion = ++sessionLoadVersionRef.current;

    // 切换 Agent 时先停止旧流，避免旧 Agent 的 token 混入新 Agent 恢复出的会话。
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
    setSessionId(null);
    setSessions([]);
    setSessionCursor(null);
    setHistoryCursor(null);
    setMessages([]);
    historyLoadVersionRef.current += 1;
    resetAutoScroll();

    if (!selectedAgentId || sessionMode !== "PERSISTENT") {
      return () => {
        disposed = true;
      };
    }

    setLoadingSessions(true);
    void listChatSessions(selectedAgentId, { status: sessionStatus })
      .then(async (response) => {
        if (disposed || requestVersion !== sessionLoadVersionRef.current) {
          return;
        }

        const nextSessions = response.list;
        setSessionCursor(response.nextCursor);

        if (sessionStatus === "ARCHIVED") {
          setSessions(nextSessions);
          const archivedSession = nextSessions[0];
          if (archivedSession) {
            await loadSessionMessages(archivedSession.id, requestVersion, () => !disposed);
          }
          return;
        }

        const initialSession = nextSessions[0] ?? (await createChatSession(selectedAgentId));

        if (disposed || requestVersion !== sessionLoadVersionRef.current) {
          return;
        }

        setSessions(nextSessions.length > 0 ? nextSessions : [initialSession]);
        await loadSessionMessages(initialSession.id, requestVersion, () => !disposed);
      })
      .catch((error) => {
        if (!disposed) {
          messageApi.error(error instanceof Error ? error.message : "加载历史会话失败");
        }
      })
      .finally(() => {
        if (!disposed && requestVersion === sessionLoadVersionRef.current) {
          setLoadingSessions(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [messageApi, resetAutoScroll, selectedAgent?.chatSessionMode, selectedAgentId, sessionStatus]);
  const sendButtonDisabled =
    !sending &&
    (sessionStatus === "ARCHIVED" ||
      !selectedAgentId ||
      (!input.trim() && images.length === 0 && files.length === 0));

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
      const requestedAgentId = searchParams.get("agentId") || "";
      const hasRequestedAgent = enabledAgents.some((agent) => agent.id === requestedAgentId);

      if (isActive()) {
        setAgents(enabledAgents);
        // 无效或已禁用的 Agent 不应让 URL 长期停留在一个无法展示的详情状态。
        if (requestedAgentId && !hasRequestedAgent) {
          setSearchParams({}, { replace: true });
        }
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
    if (agentId) {
      setSearchParams({ agentId });
    } else {
      setSearchParams({});
    }
  }

  /** 返回卡片列表时中止生成并清空 URL 选择，详情状态由现有切换 Effect 统一复位。 */
  function handleBackToAgents() {
    abortControllerRef.current?.abort();
    setSearchParams({});
  }

  async function loadSessionMessages(
    nextSessionId: string,
    requestVersion: number,
    isActive: () => boolean = () => true
  ) {
    const page = await getChatSessionMessages(nextSessionId);

    if (!isActive() || requestVersion !== sessionLoadVersionRef.current) {
      return;
    }

    setSessionId(nextSessionId);
    setMessages(page.list.map(toChatUiMessage));
    setHistoryCursor(page.nextBefore);
    resetAutoScroll();
  }

  /** 切换会话时先读取完整首屏消息，再提交选中状态，避免短暂混用旧上下文。 */
  async function handleSessionChange(nextSessionId: string) {
    if (nextSessionId === sessionId || sending) {
      return;
    }

    const requestVersion = ++sessionLoadVersionRef.current;
    historyLoadVersionRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
    setMessages([]);
    setHistoryCursor(null);
    setLoadingHistory(true);

    try {
      await loadSessionMessages(nextSessionId, requestVersion);
    } catch (error) {
      if (requestVersion === sessionLoadVersionRef.current) {
        messageApi.error(error instanceof Error ? error.message : "加载历史消息失败");
      }
    } finally {
      if (requestVersion === sessionLoadVersionRef.current) {
        setLoadingHistory(false);
      }
    }
  }

  /** 创建持久会话并立即切换；临时模式不会调用此入口。 */
  async function handleCreateSession() {
    if (!selectedAgentId || sending) {
      return;
    }

    setLoadingSessions(true);

    try {
      const session = await createChatSession(selectedAgentId);
      sessionLoadVersionRef.current += 1;
      historyLoadVersionRef.current += 1;
      setSessions((current) => [session, ...current]);
      setSessionId(session.id);
      setMessages([]);
      setHistoryCursor(null);
      resetAutoScroll();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "新建会话失败");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadMoreSessions() {
    if (!selectedAgentId || !sessionCursor || loadingSessions || sending) {
      return;
    }

    setLoadingSessions(true);
    try {
      const response = await listChatSessions(selectedAgentId, {
        cursor: sessionCursor,
        status: sessionStatus
      });
      setSessions((current) => [
        ...current,
        ...response.list.filter((item) => !current.some((existing) => existing.id === item.id))
      ]);
      setSessionCursor(response.nextCursor);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载更多会话失败");
    } finally {
      setLoadingSessions(false);
    }
  }

  async function handleRenameSession(targetSessionId: string, title: string) {
    try {
      const session = await updateChatSessionTitle(targetSessionId, title);
      setSessions((current) =>
        current.map((item) => (item.id === targetSessionId ? session : item))
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "修改会话标题失败");
    }
  }

  async function handleArchiveSession(targetSessionId: string) {
    if (sending) {
      return;
    }

    try {
      await archiveChatSession(targetSessionId);
      const nextSessions = sessions.filter((item) => item.id !== targetSessionId);
      setSessions(nextSessions);

      if (targetSessionId === sessionId) {
        if (nextSessions[0]) {
          await handleSessionChange(nextSessions[0].id);
        } else {
          await handleCreateSession();
        }
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "归档会话失败");
    }
  }

  /** 归档视图与活跃视图共用列表加载逻辑，切换时 effect 会取消旧请求并读取对应状态。 */
  function handleToggleArchivedSessions() {
    if (sending) {
      return;
    }

    setSessionStatus((current) => (current === "ACTIVE" ? "ARCHIVED" : "ACTIVE"));
  }

  /** 恢复后切回活跃列表，避免归档视图继续展示已经可写入的会话。 */
  async function handleRestoreSession(targetSessionId: string) {
    if (sending) {
      return;
    }

    try {
      await restoreChatSession(targetSessionId);
      messageApi.success("会话已恢复");
      setSessionStatus("ACTIVE");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "恢复会话失败");
    }
  }

  /** 删除仅在归档视图触发，删除后清空已选会话，等待列表 effect 选择下一条。 */
  async function handleDeleteSession(targetSessionId: string) {
    if (sending) {
      return;
    }

    try {
      await deleteChatSession(targetSessionId);
      setSessions((current) => current.filter((session) => session.id !== targetSessionId));
      if (sessionId === targetSessionId) {
        historyLoadVersionRef.current += 1;
        setSessionId(null);
        setMessages([]);
        setHistoryCursor(null);
      }
      messageApi.success("归档会话已删除");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除会话失败");
    }
  }

  async function loadOlderMessages() {
    if (!sessionId || !historyCursor || loadingHistory) {
      return;
    }

    const requestVersion = ++historyLoadVersionRef.current;
    const messagesElement = messagesRef.current;
    const previousHeight = messagesElement?.scrollHeight ?? 0;
    const previousTop = messagesElement?.scrollTop ?? 0;
    setLoadingHistory(true);

    try {
      const page = await getChatSessionMessages(sessionId, { before: historyCursor });

      if (requestVersion !== historyLoadVersionRef.current) {
        return;
      }

      setMessages((current) => [...page.list.map(toChatUiMessage), ...current]);
      setHistoryCursor(page.nextBefore);

      // prepend 会改变 scrollHeight；补偿高度差后用户仍停留在原先阅读的位置。
      requestAnimationFrame(() => {
        const currentElement = messagesRef.current;

        if (currentElement) {
          currentElement.scrollTop = previousTop + (currentElement.scrollHeight - previousHeight);
        }
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载更早消息失败");
    } finally {
      if (requestVersion === historyLoadVersionRef.current) {
        setLoadingHistory(false);
      }
    }
  }

  /**
   * 提交用户消息并把 SSE 过程事件合并到当前 assistant 气泡。
   * AbortController 同时承担用户停止生成和页面切换时的上游取消。
   */
  async function handleSend(retry?: { assistantMessageId: string; content: string }) {
    if (disposedRef.current) {
      return;
    }

    const content = retry?.content.trim() ?? input.trim();

    if (!selectedAgentId) {
      messageApi.warning("请选择 Agent");
      return;
    }

    if (sessionStatus === "ARCHIVED") {
      messageApi.warning("已归档会话仅可查看，恢复后可继续对话");
      return;
    }

    // 保留型 Agent 的每条消息必须归属到明确会话，不能退回旧的按 Agent 聚合逻辑。
    if (selectedAgent?.chatSessionMode === "PERSISTENT" && !sessionId) {
      messageApi.warning("历史会话正在初始化，请稍后再试");
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

    const currentImages = (retry ? [] : images).map(({ name, mimeType, dataUrl }) => ({
      name,
      mimeType,
      dataUrl
    }));
    const currentFiles = (retry ? [] : files).map(
      ({ name, mimeType, size, content: fileContent }) => ({
        name,
        mimeType,
        size,
        content: fileContent
      })
    );
    const nextUserMessage: ChatUiMessage = {
      id: createMessageId(),
      role: "user",
      content,
      images: currentImages,
      files: currentFiles,
      createdAt: Date.now()
    };
    const assistantMessageId = createMessageId();
    streamStartedAtRef.current.set(assistantMessageId, Date.now());
    firstTokenRecordedRef.current.delete(assistantMessageId);
    const retryMessageIndex = retry
      ? messages.findIndex((item) => item.id === retry.assistantMessageId)
      : -1;
    const historyMessages =
      retryMessageIndex > 0 ? messages.slice(0, retryMessageIndex - 1) : messages;
    const history =
      selectedAgent?.chatSessionMode === "EPHEMERAL"
        ? buildTransportHistory(historyMessages, { maxTurns: selectedAgent.historyTurns })
        : undefined;

    resetAutoScroll();
    setMessages((current) => {
      const withoutFailedAttempt = retry
        ? current.filter((item) => item.id !== retry.assistantMessageId)
        : current;
      return [
        ...withoutFailedAttempt,
        nextUserMessage,
        {
          id: assistantMessageId,
          role: "assistant" as const,
          content: "",
          createdAt: Date.now(),
          generationStatus: "streaming" as const
        }
      ];
    });
    if (!retry) {
      setInput("");
      clearAttachments();
    }
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
          ...(history !== undefined ? { history } : {})
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            // Abort 后仍可能有一个已经排队的 SSE 事件到达，不能让它更新已停止或已卸载的页面。
            if (disposedRef.current || controller.signal.aborted) {
              return;
            }

            if (event.type === "token" && event.data.content) {
              if (!firstTokenRecordedRef.current.has(assistantMessageId)) {
                firstTokenRecordedRef.current.add(assistantMessageId);
                updateAssistantRuntimeMetadata(assistantMessageId, {
                  firstTokenMs:
                    Date.now() - (streamStartedAtRef.current.get(assistantMessageId) ?? Date.now())
                });
              }
              appendAssistantToken(assistantMessageId, event.data.content);
            }

            if (event.type === "message_start" && event.data.sessionId) {
              setSessionId(event.data.sessionId);
            }

            if (event.type === "message_start") {
              updateAssistantRuntimeMetadata(assistantMessageId, {
                runId: event.data.runId,
                modelConfigId: event.data.modelConfigId,
                modelName: event.data.modelName,
                providerName: event.data.providerName
              });
            }

            if (event.type === "tool_search_result") {
              updateAssistantRuntimeMetadata(assistantMessageId, {
                toolSearch: {
                  boundToolCount: event.data.boundToolCount,
                  catalogMatchCount: event.data.catalogMatchCount,
                  selectedToolIds: event.data.selectedToolIds
                }
              });
            }

            if (event.type === "message_end" && typeof event.data.content === "string") {
              // Workflow End answer 是最终权威内容，可能没有 token，也可能转换过中间模型输出。
              replaceAssistantContent(assistantMessageId, event.data.content);
              updateAssistantGeneration(assistantMessageId, "completed");
              updateAssistantRuntimeMetadata(assistantMessageId, {
                runId: event.data.runId,
                modelConfigId: event.data.modelConfigId,
                modelName: event.data.modelName,
                providerName: event.data.providerName,
                usage: event.data.usage,
                elapsedMs:
                  Date.now() - (streamStartedAtRef.current.get(assistantMessageId) ?? Date.now())
              });
              if (event.data.messageId) {
                updateAssistantPersistedId(assistantMessageId, event.data.messageId);
              }
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

            if (event.type === "tool_approval_required" && event.data.approvalId) {
              updateToolApproval(assistantMessageId, {
                toolCallId: event.data.toolCallId || "",
                approvalId: event.data.approvalId,
                expiresAt: event.data.expiresAt
              });
            }

            if (event.type === "tool_approval_resolved") {
              resolveToolApproval(assistantMessageId, event.data.toolCallId || "");
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
          updateAssistantGeneration(assistantMessageId, "stopped");
        }
      } else if (!disposedRef.current) {
        updateAssistantGeneration(
          assistantMessageId,
          "error",
          error instanceof Error ? error.message : "对话失败"
        );
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      streamStartedAtRef.current.delete(assistantMessageId);
      firstTokenRecordedRef.current.delete(assistantMessageId);

      if (!disposedRef.current) {
        setSending(false);
      }
    }

    if (selectedAgent?.chatSessionMode === "PERSISTENT" && sessionId) {
      updateActiveSessionPreview(sessionId, content);
    }
  }

  function updateActiveSessionPreview(targetSessionId: string, firstMessage: string) {
    setSessions((current) => {
      const currentSession = current.find((item) => item.id === targetSessionId);

      if (!currentSession) {
        return current;
      }

      const nextTitle =
        currentSession.title === "新对话" ? createSessionTitle(firstMessage) : currentSession.title;
      const updatedSession = {
        ...currentSession,
        title: nextTitle,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // 新消息的会话回到顶部，侧栏排序和下一次服务端刷新保持一致。
      return [updatedSession, ...current.filter((item) => item.id !== targetSessionId)];
    });
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleRetryMessage(assistantMessageId: string) {
    if (sending) {
      return;
    }

    const assistantIndex = messages.findIndex((item) => item.id === assistantMessageId);
    const assistantMessage = messages[assistantIndex];
    const userMessage = assistantIndex > 0 ? messages[assistantIndex - 1] : undefined;

    if (!assistantMessage || userMessage?.role !== "user") {
      messageApi.warning("找不到这次回答对应的问题");
      return;
    }

    if (assistantMessage.toolEvents?.length) {
      messageApi.warning("该回答执行过工具，为避免重复操作，请重新发送问题");
      return;
    }

    void handleSend({ assistantMessageId, content: userMessage.content });
  }

  async function copyMessageContent(content: string) {
    if (!content.trim()) {
      return;
    }

    await navigator.clipboard.writeText(content);
    messageApi.success("已复制");
  }

  async function handleMessageFeedback(messageId: string, rating: "UP" | "DOWN") {
    const item = messages.find((message) => message.id === messageId);
    if (!item?.persistedMessageId) {
      messageApi.warning("只有已保存的会话消息可以提交反馈");
      return;
    }
    if (rating === "DOWN") {
      let reason = item.feedback?.rating === "DOWN" ? item.feedback.reason || "" : "";
      modal.confirm({
        title: "这条回答哪里需要改进？",
        content: (
          <Input.TextArea
            defaultValue={reason}
            maxLength={500}
            placeholder="可选：例如引用不准确、没有回答问题、工具调用错误"
            rows={4}
            showCount
            onChange={(event) => {
              reason = event.target.value;
            }}
          />
        ),
        okText: "提交反馈",
        cancelText: "取消",
        onOk: () => submitMessageFeedback(item.id, item.persistedMessageId!, rating, reason)
      });
      return;
    }

    await submitMessageFeedback(item.id, item.persistedMessageId, rating);
  }

  async function submitMessageFeedback(
    messageId: string,
    persistedMessageId: string,
    rating: "UP" | "DOWN",
    reason?: string
  ) {
    try {
      const feedback = await submitChatMessageFeedback(persistedMessageId, rating, reason);
      setMessages((current) =>
        current.map((message) => (message.id === messageId ? { ...message, feedback } : message))
      );
      messageApi.success("感谢反馈");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "提交反馈失败");
    }
  }

  function exportCurrentConversation() {
    if (!selectedAgent || messages.length === 0) {
      return;
    }

    const title = sessions.find((session) => session.id === sessionId)?.title || selectedAgent.name;
    const markdown = [
      `# ${title}`,
      "",
      `Agent：${selectedAgent.name}`,
      `导出时间：${new Date().toLocaleString()}`,
      "",
      ...messages.flatMap((item) => [
        `## ${item.role === "user" ? "用户" : "Agent"}`,
        "",
        item.content ||
          (item.generationStatus === "error" ? `> ${item.errorMessage || "回答失败"}` : ""),
        "",
        ...(item.role === "assistant" && item.runtimeMetadata?.requestId
          ? [`Request ID：${item.runtimeMetadata.requestId}`, ""]
          : [])
      ])
    ].join("\n");
    const blobUrl = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    );
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${sanitizeExportFilename(title)}.md`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  }

  return (
    <section className="workspace chatWorkspace">
      <ChatHeader
        agent={selectedAgent}
        detail={Boolean(selectedAgentId)}
        loadingAgents={loadingAgents}
        onBack={handleBackToAgents}
        onExport={messages.length > 0 ? exportCurrentConversation : undefined}
        onRefreshAgents={() => void refreshAgents()}
      />

      {!selectedAgentId ? (
        <ChatAgentGallery agents={agents} loading={loadingAgents} onOpen={handleAgentChange} />
      ) : null}

      {selectedAgentId ? (
        <div
          className={`chatLayout${
            selectedAgent?.chatSessionMode === "PERSISTENT" ? "" : " chatLayoutSingle"
          }`}
        >
          {selectedAgent?.chatSessionMode === "PERSISTENT" ? (
            <aside className="chatSide panel">
              <div className="panelHeader chatSideHeader">
                <div>
                  <h2>会话</h2>
                  <span>你的历史对话</span>
                </div>
              </div>
              <div className="chatSideBody">
                <ChatSessionList
                  activeSessionId={sessionId}
                  disabled={sending}
                  hasMore={Boolean(sessionCursor)}
                  loading={loadingSessions}
                  sessions={sessions}
                  showingArchived={sessionStatus === "ARCHIVED"}
                  onArchive={(targetSessionId) => void handleArchiveSession(targetSessionId)}
                  onCreate={() => void handleCreateSession()}
                  onDelete={(targetSessionId) => void handleDeleteSession(targetSessionId)}
                  onRename={(targetSessionId, title) =>
                    void handleRenameSession(targetSessionId, title)
                  }
                  onRestore={(targetSessionId) => void handleRestoreSession(targetSessionId)}
                  onSelect={(targetSessionId) => void handleSessionChange(targetSessionId)}
                  onToggleArchived={handleToggleArchivedSessions}
                  onLoadMore={() => void loadMoreSessions()}
                />
              </div>
            </aside>
          ) : null}

          <div className="chatPanel panel">
            <ChatTranscript
              messages={messages}
              messagesRef={messagesRef}
              sending={sending}
              hasMoreHistory={Boolean(historyCursor)}
              loadingHistory={loadingHistory}
              showScrollBottom={showScrollBottom}
              onCopyMessage={(content) => void copyMessageContent(content)}
              onRetryMessage={handleRetryMessage}
              onOpenLogs={(requestId) =>
                navigate(`/operations/logs?requestId=${encodeURIComponent(requestId)}`)
              }
              onFeedback={(messageId, rating) => void handleMessageFeedback(messageId, rating)}
              onUsePrompt={setInput}
              onLoadMoreHistory={() => void loadOlderMessages()}
              onScroll={releaseAutoScrollIfNeeded}
              onScrollBottom={scrollMessagesToBottom}
            />
            <ChatComposer
              files={files}
              images={images}
              input={input}
              selectedAgentId={selectedAgentId}
              disabled={sessionStatus === "ARCHIVED"}
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
      ) : null}
    </section>
  );
}

/** 服务端历史消息映射所需字段。 */
type PersistedChatMessage = {
  /** 服务端消息 ID。 */
  id: string;
  /** 消息发送方。 */
  role: "user" | "assistant";
  /** 消息正文。 */
  content: string;
  /** assistant 运行快照；兼容旧消息为空。 */
  metadata: import("./api").ChatMessageMetadata | null;
  /** 当前用户已提交的评价。 */
  feedback: import("./api").ChatMessageFeedback | null;
  /** ISO 格式创建时间。 */
  createdAt: string;
};

/** 将接口返回的持久化消息映射成消息组件使用的视图模型。 */
function toChatUiMessage(message: PersistedChatMessage): ChatUiMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: new Date(message.createdAt).getTime(),
    generationStatus: message.role === "assistant" ? "completed" : undefined,
    retrievalEvents: message.metadata?.retrievalEvents?.map((event) => ({
      id: createMessageId(),
      knowledgeBaseIds: event.knowledgeBaseIds,
      status: event.status,
      sources: event.sources,
      elapsedMs: event.elapsedMs
    })),
    toolEvents: message.metadata?.toolEvents,
    runtimeMetadata: message.metadata
      ? {
          requestId: message.metadata.requestId,
          runId: message.metadata.runId,
          modelConfigId: message.metadata.modelConfigId,
          modelName: message.metadata.modelName,
          providerName: message.metadata.providerName,
          elapsedMs: message.metadata.elapsedMs,
          firstTokenMs: message.metadata.firstTokenMs,
          usage: message.metadata.usage,
          toolSearch: message.metadata.toolSearch
        }
      : undefined,
    feedback: message.feedback,
    persistedMessageId: message.role === "assistant" ? message.id : undefined
  };
}

/** 使用首条用户消息生成乐观会话标题，服务端持久化后会返回最终值。 */
function createSessionTitle(content: string): string {
  const normalized = content.replace(/\s+/gu, " ").trim();

  if (!normalized) {
    return "新对话";
  }

  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function sanitizeExportFilename(value: string): string {
  const filename = value.replace(/[\\/:*?"<>|]/gu, "-").trim();
  return filename || "mia-chat";
}
