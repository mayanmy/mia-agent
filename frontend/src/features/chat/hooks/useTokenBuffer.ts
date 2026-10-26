import { useCallback, useEffect, useRef } from "react";

/** 单次提交给消息状态的 Token 批次。 */
export type TokenBatch = {
  /** 当前流式 Assistant 消息 ID。 */
  messageId: string;
  /** 按接收顺序合并后的文本增量。 */
  content: string;
};

type UseTokenBufferOptions = {
  /** 动画帧被浏览器降频时的最大等待时间。 */
  maxWaitMs?: number;
  /** 防止异常大事件长期积压的字符数上限。 */
  maxBufferChars?: number;
  /** 将一个完整批次提交给上层消息状态。 */
  onFlush: (batch: TokenBatch) => void;
};

type UseTokenBufferResult = {
  /** 追加 Token，并安排下一次批量刷新。 */
  append: (messageId: string, content: string) => void;
  /** 同步提交当前缓冲，供停止和错误路径保留尾部内容。 */
  flush: (messageId?: string) => void;
  /** 丢弃当前缓冲，供最终正文覆盖和页面切换使用。 */
  clear: (messageId?: string) => void;
};

const DEFAULT_MAX_WAIT_MS = 50;
const DEFAULT_MAX_BUFFER_CHARS = 4096;

/**
 * 将高频 Token 合并到浏览器动画帧，降低消息状态更新、Markdown 解析和滚动频率。
 * 定时器是后台标签页兜底；两个调度器中任意一个触发后都会取消另一个，避免重复提交。
 */
export function useTokenBuffer({
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  maxBufferChars = DEFAULT_MAX_BUFFER_CHARS,
  onFlush
}: UseTokenBufferOptions): UseTokenBufferResult {
  const buffersRef = useRef<Map<string, string>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const onFlushRef = useRef(onFlush);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  const cancelScheduledFlush = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(
    (targetMessageId?: string) => {
      cancelScheduledFlush();
      const entries = targetMessageId
        ? ([[targetMessageId, buffersRef.current.get(targetMessageId) ?? ""]] as const)
        : [...buffersRef.current.entries()];
      for (const [messageId, content] of entries) {
        buffersRef.current.delete(messageId);
        if (content) onFlushRef.current({ messageId, content });
      }
    },
    [cancelScheduledFlush]
  );

  const clear = useCallback(
    (targetMessageId?: string) => {
      cancelScheduledFlush();
      if (targetMessageId) buffersRef.current.delete(targetMessageId);
      else buffersRef.current.clear();
    },
    [cancelScheduledFlush]
  );

  const scheduleFlush = useCallback(() => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        flush();
      });
    }

    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, maxWaitMs);
    }
  }, [flush, maxWaitMs]);

  const append = useCallback(
    (messageId: string, content: string) => {
      if (!messageId || !content) {
        return;
      }

      const next = `${buffersRef.current.get(messageId) ?? ""}${content}`;
      buffersRef.current.set(messageId, next);

      if (next.length >= maxBufferChars) {
        flush(messageId);
        return;
      }

      scheduleFlush();
    },
    [flush, maxBufferChars, scheduleFlush]
  );

  useEffect(() => clear, [clear]);

  return { append, flush, clear };
}
