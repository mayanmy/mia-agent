import { useState } from "react";
import { Button } from "antd";
import { CopyOutlined, InfoCircleOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatRetrievalSource } from "../api";
import type { ChatUiMessage } from "../types";
import { formatMessageTime } from "../utils";
import { RetrievalEventCard } from "./RetrievalEventCard";
import { ToolEventCard } from "./ToolEventCard";

/** 单条聊天消息组件参数。 */
type ChatMessageItemProps = {
  /** 包含附件和过程事件的 UI 消息。 */
  item: ChatUiMessage;
  /** 该消息是否仍在接收流式内容。 */
  generating: boolean;
  /** 复制消息正文回调。 */
  onCopy: (content: string) => void;
  /** 重新提交该回答对应的上一条用户消息。 */
  onRetry?: () => void;
};

/** 渲染用户或 Agent 消息及其检索、工具和引用信息。 */
export function ChatMessageItem({
  item,
  generating,
  onCopy,
  onRetry
}: ChatMessageItemProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const citationSources = getCitationSources(item);

  return (
    <div className={`chatMessage ${item.role}`}>
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
        {item.retrievalEvents?.length ? (
          <div className="chatRetrievalEvents">
            {item.retrievalEvents.map((retrievalEvent) => (
              <RetrievalEventCard key={retrievalEvent.id} retrievalEvent={retrievalEvent} />
            ))}
          </div>
        ) : null}
        {item.toolEvents?.length ? (
          <div className="chatToolEvents">
            {item.toolEvents.map((toolEvent) => (
              <ToolEventCard key={toolEvent.id} toolEvent={toolEvent} />
            ))}
          </div>
        ) : null}
        <MarkdownMessageContent content={item.content} />
        {generating ? <GeneratingIndicator /> : null}
        {item.generationStatus === "error" ? (
          <div className="chatGenerationNotice error" role="alert">
            <div>
              <strong>回答生成失败</strong>
              <span>{item.errorMessage || "服务暂时不可用，请稍后重试。"}</span>
            </div>
            {onRetry ? <Button size="small" onClick={onRetry}>重试</Button> : null}
          </div>
        ) : null}
        {item.generationStatus === "stopped" ? (
          <div className="chatGenerationNotice stopped">已停止生成，已保留当前回答。</div>
        ) : null}
        {citationSources.length > 0 ? <CitationSourceList sources={citationSources} /> : null}
        {detailsOpen && item.runtimeMetadata ? (
          <RuntimeDetails metadata={item.runtimeMetadata} />
        ) : null}
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
          onClick={() => onCopy(item.content)}
        />
        {item.role === "assistant" && item.generationStatus === "stopped" && onRetry ? (
          <Button className="chatMessageMetaButton" size="small" type="text" onClick={onRetry}>
            重试
          </Button>
        ) : null}
        {item.role === "assistant" && item.runtimeMetadata ? (
          <Button
            className="chatMessageMetaButton"
            icon={<InfoCircleOutlined />}
            size="small"
            type="text"
            onClick={() => setDetailsOpen((current) => !current)}
          >
            运行详情
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RuntimeDetails({ metadata }: { metadata: NonNullable<ChatUiMessage["runtimeMetadata"]> }) {
  const rows = [
    ["模型", [metadata.providerName, metadata.modelName].filter(Boolean).join(" / ")],
    ["总耗时", metadata.elapsedMs === undefined ? "" : `${metadata.elapsedMs}ms`],
    ["输入 Token", metadata.usage?.inputTokens?.toLocaleString() ?? ""],
    ["输出 Token", metadata.usage?.outputTokens?.toLocaleString() ?? ""],
    ["候选工具", metadata.toolSearch?.catalogMatchCount?.toString() ?? ""],
    ["选中工具", metadata.toolSearch?.selectedToolIds?.join("、") ?? ""],
    ["Request ID", metadata.requestId ?? ""],
    ["Run ID", metadata.runId ?? ""]
  ].filter((row) => row[1]);

  return (
    <div className="chatRuntimeDetails">
      {rows.map(([name, value]) => (
        <div key={name}>
          <strong>{name}</strong>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 消息内容始终保留模型返回的原始 Markdown。
 *
 * ReactMarkdown 默认不会解析原始 HTML，因此模型输出的 HTML 不会直接注入 DOM；复制按钮
 * 继续使用 item.content，确保用户拿到的是可复用的 Markdown 源文，而不是渲染后的纯文本。
 */
/** Markdown 消息正文参数。 */
type MarkdownMessageContentProps = {
  /** 待渲染的 Markdown 文本。 */
  content: string;
};

/** 使用 GFM 规则渲染模型 Markdown 输出。 */
function MarkdownMessageContent({ content }: MarkdownMessageContentProps) {
  if (!content) {
    return null;
  }

  return (
    <div className="chatMarkdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer noopener" target="_blank">
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function GeneratingIndicator() {
  return (
    <div className="chatGeneratingIndicator" role="status">
      <span>正在生成</span>
      <span className="chatGeneratingDots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function getCitationSources(item: ChatUiMessage): ChatRetrievalSource[] {
  const retrievalEvents =
    item.retrievalEvents?.filter((event) => event.status === "success" && event.sources.length > 0) ??
    [];
  const retrievalEvent = retrievalEvents[retrievalEvents.length - 1];

  return retrievalEvent?.sources ?? [];
}

/** 引用来源列表参数。 */
type CitationSourceListProps = {
  /** 去重后的检索来源。 */
  sources: ChatRetrievalSource[];
};

/** 展示回答使用的文档来源。 */
function CitationSourceList({ sources }: CitationSourceListProps) {
  return (
    <div className="chatCitationSources">
      <div className="chatCitationTitle">引用来源</div>
      <div className="chatCitationList">
        {sources.map((source, index) => (
          <div className="chatCitationItem" key={`${source.documentId}-${source.chunkId}`}>
            <span className="chatCitationIndex">[{index + 1}]</span>
            <span className="chatCitationName">{source.documentName}</span>
            <span className="chatCitationMeta">
              #{source.chunkIndex} · 相关度 {Math.max(0, Math.min(100, Math.round(source.score * 100)))}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
