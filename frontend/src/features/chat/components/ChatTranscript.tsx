import type { RefObject } from "react";
import { Button, Empty } from "antd";
import { ArrowDownOutlined } from "@ant-design/icons";

import type { ChatUiMessage } from "../types";
import { ChatMessageItem } from "./ChatMessageItem";

export function ChatTranscript({
  messages,
  messagesRef,
  sending,
  hasMoreHistory,
  loadingHistory,
  showScrollBottom,
  onScroll,
  onLoadMoreHistory,
  onScrollBottom,
  onCopyMessage
}: {
  messages: ChatUiMessage[];
  messagesRef: RefObject<HTMLDivElement | null>;
  sending: boolean;
  hasMoreHistory: boolean;
  loadingHistory: boolean;
  showScrollBottom: boolean;
  onScroll: () => void;
  onLoadMoreHistory: () => void;
  onScrollBottom: () => void;
  onCopyMessage: (content: string) => void;
}) {
  return (
    <>
      <div
        className="chatMessages"
        ref={messagesRef}
        onScroll={(event) => {
          onScroll();

          // 抵达顶部才请求下一页，且上层会用 loading 状态去重，避免滚动事件频繁触发重复读取。
          if (hasMoreHistory && !loadingHistory && event.currentTarget.scrollTop <= 24) {
            onLoadMoreHistory();
          }
        }}
      >
        {loadingHistory ? <div className="chatHistoryLoading">正在加载更早消息...</div> : null}
        {hasMoreHistory && !loadingHistory ? (
          <button className="chatHistoryLoadMore" type="button" onClick={onLoadMoreHistory}>
            加载更早消息
          </button>
        ) : null}
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
