import { Button } from "antd";
import { CopyOutlined } from "@ant-design/icons";

import type { ChatUiMessage } from "../types";
import { formatMessageTime } from "../utils";
import { ToolEventCard } from "./ToolEventCard";

export function ChatMessageItem({
  item,
  sending,
  onCopy
}: {
  item: ChatUiMessage;
  sending: boolean;
  onCopy: (content: string) => void;
}) {
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
        {item.toolEvents?.length ? (
          <div className="chatToolEvents">
            {item.toolEvents.map((toolEvent) => (
              <ToolEventCard key={toolEvent.id} toolEvent={toolEvent} />
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
          onClick={() => onCopy(item.content)}
        />
      </div>
    </div>
  );
}
