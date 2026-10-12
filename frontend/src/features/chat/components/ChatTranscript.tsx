import type { RefObject } from "react";
import { Button } from "antd";
import { ArrowDownOutlined, RobotOutlined } from "@ant-design/icons";

import type { ChatUiMessage } from "../types";
import { ChatMessageItem } from "./ChatMessageItem";

/** Chat 消息时间线参数。 */
type ChatTranscriptProps = {
  /** 按显示顺序排列的消息。 */
  messages: ChatUiMessage[];
  /** 可滚动消息容器引用。 */
  messagesRef: RefObject<HTMLDivElement | null>;
  /** 是否正在生成回答。 */
  sending: boolean;
  /** 是否还有更早的持久消息。 */
  hasMoreHistory: boolean;
  /** 是否正在加载更早消息。 */
  loadingHistory: boolean;
  /** 是否展示返回底部按钮。 */
  showScrollBottom: boolean;
  /** 消息容器滚动回调。 */
  onScroll: () => void;
  /** 加载更早消息回调。 */
  onLoadMoreHistory: () => void;
  /** 滚动至最新消息回调。 */
  onScrollBottom: () => void;
  /** 复制消息正文回调。 */
  onCopyMessage: (content: string) => void;
  /** 重新生成某条 assistant 回答。 */
  onRetryMessage: (messageId: string) => void;
  /** 按 run_id 直接打开对应运行链路。 */
  onOpenTrace: (runId: string) => void;
  onFeedback: (messageId: string, rating: "UP" | "DOWN") => void;
  /** 将推荐问题填入输入框，便于用户继续编辑后发送。 */
  onUsePrompt: (prompt: string) => void;
};

/** 展示消息时间线并协调历史分页和滚动跟随。 */
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
  onCopyMessage,
  onRetryMessage,
  onOpenTrace,
  onFeedback,
  onUsePrompt
}: ChatTranscriptProps) {
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
          <div className="chatWelcome">
            <span className="chatWelcomeIcon">
              <RobotOutlined />
            </span>
            <div>
              <h2>今天想一起完成什么？</h2>
              <p>直接描述目标，Agent 会结合已配置的知识与工具回答。</p>
            </div>
            <div className="chatPromptSuggestions">
              {["介绍一下你能做什么", "总结核心知识内容", "帮我制定一个执行计划"].map((prompt) => (
                <button key={prompt} type="button" onClick={() => onUsePrompt(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((item, index) => (
            <ChatMessageItem
              generating={sending && item.role === "assistant" && index === messages.length - 1}
              item={item}
              key={item.id}
              onCopy={onCopyMessage}
              onRetry={item.role === "assistant" ? () => onRetryMessage(item.id) : undefined}
              onOpenTrace={onOpenTrace}
              onFeedback={(rating) => onFeedback(item.id, rating)}
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
