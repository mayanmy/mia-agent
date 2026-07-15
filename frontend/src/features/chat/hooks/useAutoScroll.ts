import { useEffect, useRef, useState } from "react";

import { isNearScrollBottom } from "../utils";

export function useAutoScroll(dependencies: unknown[]) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const animationFrameRef = useRef<number | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    const messagesElement = messagesRef.current;

    if (!messagesElement || !autoScrollRef.current) {
      return;
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      messagesElement.scrollTop = messagesElement.scrollHeight;
      setShowScrollBottom(false);
    });

    // 消息更新过快或页面卸载时，旧帧不能再操作已销毁的滚动容器。
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, dependencies);

  function releaseAutoScrollIfNeeded() {
    const messagesElement = messagesRef.current;

    if (!messagesElement) {
      return;
    }

    const isAtBottom = isNearScrollBottom(messagesElement);
    autoScrollRef.current = isAtBottom;
    setShowScrollBottom(!isAtBottom);
  }

  function scrollMessagesToBottom() {
    const messagesElement = messagesRef.current;

    if (!messagesElement) {
      return;
    }

    autoScrollRef.current = true;
    messagesElement.scrollTop = messagesElement.scrollHeight;
    setShowScrollBottom(false);
  }

  function resetAutoScroll() {
    autoScrollRef.current = true;
    setShowScrollBottom(false);
  }

  return {
    messagesRef,
    showScrollBottom,
    releaseAutoScrollIfNeeded,
    scrollMessagesToBottom,
    resetAutoScroll
  };
}
