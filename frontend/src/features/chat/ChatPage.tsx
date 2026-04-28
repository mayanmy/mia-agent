import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Empty, Input, Select, Space, Tag, Upload, message } from "antd";
import type { UploadProps } from "antd";

import { listAgents, type AgentListItem } from "../agents/api";
import { streamChatCompletion, type ChatImageAttachment, type ChatMessage } from "./api";

type ChatUiMessage = ChatMessage & {
  id: string;
};

const maxImageSize = 5 * 1024 * 1024;

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatPage() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get("agentId") || "");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  useEffect(() => {
    void refreshAgents();
  }, []);

  useEffect(() => {
    const messagesElement = messagesRef.current;

    if (!messagesElement) {
      return;
    }

    requestAnimationFrame(() => {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    });
  }, [messages, sending]);

  async function refreshAgents() {
    setLoadingAgents(true);

    try {
      const page = await listAgents(1, 100);
      const enabledAgents = page.list.filter((agent) => agent.enabled);
      const nextAgentId = searchParams.get("agentId") || selectedAgentId || enabledAgents[0]?.id || "";

      setAgents(enabledAgents);
      setSelectedAgentId(nextAgentId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Agent 失败");
    } finally {
      setLoadingAgents(false);
    }
  }

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId);
    setMessages([]);

    if (agentId) {
      setSearchParams({ agentId });
    } else {
      setSearchParams({});
    }
  }

  async function handleSend() {
    const content = input.trim();

    if (!selectedAgentId) {
      message.warning("请选择 Agent");
      return;
    }

    if (!content && images.length === 0) {
      return;
    }

    const currentImages = images;
    const nextUserMessage: ChatUiMessage = {
      id: createMessageId(),
      role: "user",
      content,
      images: currentImages
    };
    const assistantMessageId = createMessageId();
    const history = messages.map(({ role, content: messageContent }) => ({
      role,
      content: messageContent
    }));

    setMessages((current) => [
      ...current,
      nextUserMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: ""
      }
    ]);
    setInput("");
    setImages([]);
    setSending(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamChatCompletion(
        {
          agentId: selectedAgentId,
          message: content,
          images: currentImages,
          history
        },
        {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "token" && event.data.content) {
              appendAssistantToken(assistantMessageId, event.data.content);
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
        message.error(error instanceof Error ? error.message : "对话失败");
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

  function removeAssistantMessageIfEmpty(messageId: string) {
    setMessages((current) =>
      current.filter((item) => item.id !== messageId || item.content.trim().length > 0)
    );
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  const handleBeforeUpload: UploadProps["beforeUpload"] = async (file) => {
    if (!file.type?.startsWith("image/")) {
      message.warning("只能上传图片");
      return Upload.LIST_IGNORE;
    }

    if ((file.size ?? 0) > maxImageSize) {
      message.warning("单张图片不能超过 5MB");
      return Upload.LIST_IGNORE;
    }

    if (images.length >= 4) {
      message.warning("一次最多上传 4 张图片");
      return Upload.LIST_IGNORE;
    }

    const dataUrl = await readFileAsDataUrl(file);

    setImages((current) => [
      ...current,
      {
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl
      }
    ]);

    return false;
  };

  function removeImage(dataUrl: string) {
    setImages((current) => current.filter((item) => item.dataUrl !== dataUrl));
  }

  return (
    <section className="workspace chatWorkspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Chat</p>
          <h1>测试对话</h1>
        </div>
        <Space>
          <Button disabled={loadingAgents} onClick={() => void refreshAgents()}>
            刷新 Agent
          </Button>
        </Space>
      </header>

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
          <div className="chatMessages" ref={messagesRef}>
            {messages.length === 0 ? (
              <Empty description="发送一条消息测试 Agent" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              messages.map((item) => (
                <div className={`chatMessage ${item.role}`} key={item.id}>
                  <div className="chatMessageRole">{item.role === "user" ? "你" : "Agent"}</div>
                  <div className="chatMessageBubble">
                    {item.images?.length ? (
                      <div className="chatImageGrid">
                        {item.images.map((image) => (
                          <img alt={image.name} className="chatImagePreview" key={image.dataUrl} src={image.dataUrl} />
                        ))}
                      </div>
                    ) : null}
                    {item.content || (item.role === "assistant" && sending ? "正在生成..." : "")}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="chatComposer">
            <div className="chatComposerInput">
              {images.length > 0 ? (
                <div className="chatUploadPreviewList">
                  {images.map((image) => (
                    <div className="chatUploadPreview" key={image.dataUrl}>
                      <img alt={image.name} src={image.dataUrl} />
                      <Button size="small" type="text" onClick={() => removeImage(image.dataUrl)}>
                        移除
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                disabled={!selectedAgentId || sending}
                placeholder="输入消息，测试当前 Agent 的真实模型调用"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPressEnter={(event) => {
                  if (!event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
            </div>
            <Upload
              accept="image/*"
              beforeUpload={handleBeforeUpload}
              disabled={!selectedAgentId || sending}
              maxCount={4}
              showUploadList={false}
            >
              <Button disabled={!selectedAgentId || sending}>上传图片</Button>
            </Upload>
            <Button
              disabled={!selectedAgentId || (!sending && !input.trim() && images.length === 0)}
              danger={sending}
              type="primary"
              onClick={() => {
                if (sending) {
                  handleStop();
                  return;
                }

                void handleSend();
              }}
            >
              {sending ? "停止" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
