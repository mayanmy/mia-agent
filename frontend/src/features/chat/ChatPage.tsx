import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { App as AntdApp, Button, Empty, Input, Select, Space, Tag, Upload } from "antd";
import type { UploadProps } from "antd";
import { CloseOutlined, CopyOutlined } from "@ant-design/icons";

import { listAgents, type AgentListItem } from "../agents/api";
import {
  streamChatCompletion,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type ChatMessage
} from "./api";

type ChatUiMessage = ChatMessage & {
  id: string;
  createdAt: number;
};

const maxImageSize = 5 * 1024 * 1024;
const maxFileSize = 1024 * 1024;
const supportedTextFileExtensions = [
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".sql"
];

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMessageTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function ChatPage() {
  const { message: messageApi } = AntdApp.useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(searchParams.get("agentId") || "");
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [files, setFiles] = useState<ChatFileAttachment[]>([]);
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
      messageApi.error(error instanceof Error ? error.message : "加载 Agent 失败");
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
    setImages([]);
    setFiles([]);
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

  async function addImageFile(file: File): Promise<boolean> {
    if (!file.type?.startsWith("image/")) {
      messageApi.warning("只能上传图片");
      return false;
    }

    if (file.size > maxImageSize) {
      messageApi.warning("单张图片不能超过 5MB");
      return false;
    }

    if (images.length >= 4) {
      messageApi.warning("一次最多上传 4 张图片");
      return false;
    }

    const dataUrl = await readFileAsDataUrl(file);

    setImages((current) => [
      ...current,
      {
        id: createMessageId(),
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl
      }
    ]);

    return true;
  }

  const handleBeforeUpload: UploadProps["beforeUpload"] = async (file) => {
    await addImageFile(file);
    return false;
  };

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (files.length === 0) {
      return;
    }

    event.preventDefault();

    void addPastedImages(files);
  }

  async function addPastedImages(files: File[]) {
    const remainingSlots = 4 - images.length;
    const filesToAdd = files.slice(0, Math.max(remainingSlots, 0));
    let addedCount = 0;

    if (filesToAdd.length < files.length) {
      messageApi.warning("一次最多保留 4 张图片");
    }

    for (const file of filesToAdd) {
      const added = await addImageFile(file);

      if (added) {
        addedCount += 1;
      }
    }

    if (addedCount > 0) {
      messageApi.success(`已粘贴 ${addedCount} 张图片`);
    }
  }

  function removeImage(id: string | undefined) {
    if (!id) {
      return;
    }

    setImages((current) => current.filter((item) => item.id !== id));
  }

  async function addTextFile(file: File): Promise<boolean> {
    if (!isSupportedTextFile(file)) {
      messageApi.warning("当前只支持文本类文件，例如 txt、md、json、csv、代码文件");
      return false;
    }

    if (file.size > maxFileSize) {
      messageApi.warning("单个文件不能超过 1MB");
      return false;
    }

    if (files.length >= 4) {
      messageApi.warning("一次最多上传 4 个文件");
      return false;
    }

    const content = await readFileAsText(file);

    setFiles((current) => [
      ...current,
      {
        id: createMessageId(),
        name: file.name,
        mimeType: file.type || "text/plain",
        size: file.size,
        content
      }
    ]);

    return true;
  }

  const handleFileBeforeUpload: UploadProps["beforeUpload"] = async (file) => {
    await addTextFile(file);
    return false;
  };

  function removeFile(id: string | undefined) {
    if (!id) {
      return;
    }

    setFiles((current) => current.filter((item) => item.id !== id));
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
                        {item.images.map((image, index) => (
                          <img
                            alt={image.name}
                            className="chatImagePreview"
                            key={image.id ?? `${image.dataUrl}-${index}`}
                            src={image.dataUrl}
                          />
                        ))}
                      </div>
                    ) : null}
                    {item.files?.length ? (
                      <div className="chatFileGrid">
                        {item.files.map((file, index) => (
                          <div className="chatFileChip" key={file.id ?? `${file.name}-${index}`}>
                            {file.name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.content || (item.role === "assistant" && sending ? "正在生成..." : "")}
                  </div>
                  <div className="chatMessageMeta">
                    <span>{formatMessageTime(item.createdAt)}</span>
                    <Button
                      aria-label="复制消息"
                      className="chatMessageMetaButton"
                      disabled={!item.content.trim()}
                      icon={<CopyOutlined />}
                      size="small"
                      type="text"
                      onClick={() => void copyMessageContent(item.content)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="chatComposer">
            <div className="chatComposerToolbar">
              <Upload
                accept="image/*"
                beforeUpload={handleBeforeUpload}
                disabled={!selectedAgentId || sending}
                maxCount={4}
                showUploadList={false}
              >
                <Button className="chatComposerToolButton" disabled={!selectedAgentId || sending}>
                  上传图片
                </Button>
              </Upload>
              <Upload
                accept={supportedTextFileExtensions.join(",")}
                beforeUpload={handleFileBeforeUpload}
                disabled={!selectedAgentId || sending}
                maxCount={4}
                showUploadList={false}
              >
                <Button className="chatComposerToolButton" disabled={!selectedAgentId || sending}>
                  上传文件
                </Button>
              </Upload>
            </div>
            <div className="chatComposerInput">
              {images.length > 0 ? (
                <div className="chatUploadPreviewList">
                  {images.map((image, index) => (
                    <div className="chatUploadPreview" key={image.id ?? `${image.dataUrl}-${index}`}>
                      <img alt={image.name} src={image.dataUrl} />
                      <button
                        aria-label="移除图片"
                        className="attachmentRemoveButton"
                        type="button"
                        onClick={() => removeImage(image.id)}
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {files.length > 0 ? (
                <div className="chatFilePreviewList">
                  {files.map((file, index) => (
                    <div className="chatFilePreview" key={file.id ?? `${file.name}-${index}`}>
                      <span>{file.name}</span>
                      <button
                        aria-label="移除文件"
                        className="attachmentRemoveButton"
                        type="button"
                        onClick={() => removeFile(file.id)}
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 6 }}
                disabled={!selectedAgentId || sending}
                placeholder="输入消息，或直接粘贴图片"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
                onPressEnter={(event) => {
                  if (!event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
            </div>
            <Button
              disabled={
                !selectedAgentId ||
                (!sending && !input.trim() && images.length === 0 && files.length === 0)
              }
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

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

function isSupportedTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }

  const lowerName = file.name.toLowerCase();

  return supportedTextFileExtensions.some((extension) => lowerName.endsWith(extension));
}

function isLikelyVisionModel(modelName: string): boolean {
  const normalized = modelName.toLowerCase();
  const visionModelKeywords = [
    "vl",
    "vision",
    "omni",
    "qvq",
    "gpt-4o",
    "gpt-4.1",
    "gemini",
    "claude-3",
    "claude-4"
  ];

  return visionModelKeywords.some((keyword) => normalized.includes(keyword));
}
