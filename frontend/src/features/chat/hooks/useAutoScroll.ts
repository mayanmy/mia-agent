import { useEffect, useRef, useState } from "react";

import { isNearScrollBottom } from "../utils";

export function useAutoScroll(dependencies: unknown[]) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  useEffect(() => {
    const messagesElement = messagesRef.current;

    if (!messagesElement || !autoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      messagesElement.scrollTop = messagesElement.scrollHeight;
      setShowScrollBottom(false);
    });
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
