import { Button } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatRetrievalSource } from "../api";
import type { ChatUiMessage } from "../types";
import { formatMessageTime } from "../utils";
import { RetrievalEventCard } from "./RetrievalEventCard";
import { ToolEventCard } from "./ToolEventCard";

export function ChatMessageItem({
  item,
  generating,
  onCopy
}: {
  item: ChatUiMessage;
  generating: boolean;
  onCopy: (content: string) => void;
}) {
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
        {citationSources.length > 0 ? <CitationSourceList sources={citationSources} /> : null}
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
      </div>
    </div>
  );
}

/**
 * 消息内容始终保留模型返回的原始 Markdown。
 *
 * ReactMarkdown 默认不会解析原始 HTML，因此模型输出的 HTML 不会直接注入 DOM；复制按钮
 * 继续使用 item.content，确保用户拿到的是可复用的 Markdown 源文，而不是渲染后的纯文本。
 */
function MarkdownMessageContent({ content }: { content: string }) {
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

function CitationSourceList({ sources }: { sources: ChatRetrievalSource[] }) {
  return (
    <div className="chatCitationSources">
      <div className="chatCitationTitle">引用来源</div>
      <div className="chatCitationList">
        {sources.map((source, index) => (
          <div className="chatCitationItem" key={`${source.documentId}-${source.chunkId}`}>
            <span className="chatCitationIndex">[{index + 1}]</span>
            <span className="chatCitationName">{source.documentName}</span>
            <span className="chatCitationMeta">
              #{source.chunkIndex} · score {source.score.toFixed(4)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
