import type { RefObject } from "react";
import { Button, Empty } from "antd";
import { ArrowDownOutlined } from "@ant-design/icons";

import type { ChatUiMessage } from "../types";
import { ChatMessageItem } from "./ChatMessageItem";

export function ChatTranscript({
  messages,
  messagesRef,
  sending,
  showScrollBottom,
  onScroll,
  onScrollBottom,
  onCopyMessage
}: {
  messages: ChatUiMessage[];
  messagesRef: RefObject<HTMLDivElement | null>;
  sending: boolean;
  showScrollBottom: boolean;
  onScroll: () => void;
  onScrollBottom: () => void;
  onCopyMessage: (content: string) => void;
}) {
  return (
    <>
      <div className="chatMessages" ref={messagesRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <Empty description="发送一条消息测试 Agent" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          messages.map((item, index) => (
            <ChatMessageItem
              generating={
                sending &&
                item.role === "assistant" &&
                index === messages.length - 1 &&
                item.content.trim().length === 0
              }
              item={item}
              key={item.id}
              onCopy={onCopyMessage}
            />
          ))
        )}
      </div>
      {showScrollBottom ? (
        <Button
          aria-label="回到底部"
          className="chatScrollBottomButton"
          icon={<ArrowDownOutlined />}
          shape="circle"
          type="primary"
          onClick={onScrollBottom}
        />
      ) : null}
    </>
  );
}
