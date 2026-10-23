import { useEffect, useRef } from "react";

type UseChatSessionSyncOptions = {
  enabled: boolean;
  intervalMs?: number;
  refresh: () => Promise<void>;
};

/**
 * 当前设备没有对应 SSE 时，短轮询数据库中的 Turn 终态。
 * 数据库是跨标签页、跨设备的权威来源；后续可无缝替换为会话级事件流。
 */
export function useChatSessionSync({
  enabled,
  intervalMs = 2_000,
  refresh
}: UseChatSessionSyncOptions): void {
  const refreshRef = useRef(refresh);
  const refreshingRef = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    const poll = async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        refreshingRef.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}
