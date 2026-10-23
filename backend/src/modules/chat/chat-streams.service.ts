import { HttpStatus, Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";
import { ChatService, ChatRequestContext } from "./chat.service";
import { ChatCompletionDto, ChatStreamEvent } from "./dto/chat.dto";

const DISCONNECT_GRACE_MS = 60_000;
const COMPLETED_STREAM_TTL_MS = 10 * 60_000;

type ChatStreamStatus = "running" | "completed" | "failed" | "canceled";

export type StoredChatStreamEvent = ChatStreamEvent & {
  /** 单个流内严格递增的事件游标。 */
  id: number;
};

type ChatStreamRuntime = {
  id: string;
  userId: string;
  payload: ChatCompletionDto;
  context: ChatRequestContext;
  status: ChatStreamStatus;
  abortController: AbortController;
  events: StoredChatStreamEvent[];
  nextEventId: number;
  version: number;
  subscribers: number;
  waiters: Set<() => void>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

/**
 * 管理与 HTTP 连接解耦的短期 Chat 流。
 *
 * v0.1 采用单实例内存事件缓冲：网络短暂断开时生成任务继续运行，客户端按事件 ID 补发；
 * 用户主动取消或 60 秒内没有重新订阅时才中断上游模型，避免无界消耗。
 */
@Injectable()
export class ChatStreamsService implements OnModuleDestroy {
  private readonly streams = new Map<string, ChatStreamRuntime>();

  constructor(private readonly chatService: ChatService) {}

  createStream(
    payload: ChatCompletionDto,
    context: ChatRequestContext & { userId: string }
  ): { streamId: string; reconnectWindowMs: number } {
    const runtime: ChatStreamRuntime = {
      id: randomUUID(),
      userId: context.userId,
      payload,
      context,
      status: "running",
      abortController: new AbortController(),
      events: [],
      nextEventId: 1,
      version: 0,
      subscribers: 0,
      waiters: new Set()
    };

    this.streams.set(runtime.id, runtime);
    // 创建接口与订阅接口是两次 HTTP 请求；若客户端创建后即掉线，宽限期后也必须止损。
    this.scheduleDisconnectAbort(runtime);
    void this.runStream(runtime);

    return { streamId: runtime.id, reconnectWindowMs: DISCONNECT_GRACE_MS };
  }

  async *subscribe(
    streamId: string,
    userId: string,
    afterEventId: number,
    signal?: AbortSignal
  ): AsyncIterable<StoredChatStreamEvent> {
    const runtime = this.requireOwnedStream(streamId, userId);
    let cursor = this.normalizeCursor(afterEventId);
    runtime.subscribers += 1;
    this.cancelDisconnectAbort(runtime);

    try {
      while (!signal?.aborted) {
        const pending = runtime.events.filter((event) => event.id > cursor);
        for (const event of pending) {
          if (signal?.aborted) return;
          cursor = event.id;
          yield event;
        }

        // yield 会把控制权交给 HTTP 写入端；此期间可能已经追加了新事件。
        // 只要本轮消费过事件就立即重新扫描，避免在旧快照之后错误进入等待而漏掉 token。
        if (pending.length > 0) continue;

        if (runtime.status !== "running") return;

        const observedVersion = runtime.version;
        await this.waitForUpdate(runtime, observedVersion, signal);
      }
    } finally {
      runtime.subscribers = Math.max(0, runtime.subscribers - 1);
      this.scheduleDisconnectAbort(runtime);
    }
  }

  cancelStream(streamId: string, userId: string): void {
    const runtime = this.requireOwnedStream(streamId, userId);
    if (runtime.status === "running") {
      runtime.abortController.abort("user_canceled");
    }
  }

  assertStreamAccess(streamId: string, userId: string): void {
    this.requireOwnedStream(streamId, userId);
  }

  onModuleDestroy(): void {
    for (const runtime of this.streams.values()) {
      this.cancelDisconnectAbort(runtime);
      if (runtime.cleanupTimer) clearTimeout(runtime.cleanupTimer);
      runtime.abortController.abort("server_shutdown");
      this.notify(runtime);
    }
    this.streams.clear();
  }

  private async runStream(runtime: ChatStreamRuntime): Promise<void> {
    try {
      for await (const event of this.chatService.streamCompletion(
        runtime.payload,
        runtime.abortController.signal,
        runtime.context
      )) {
        this.appendEvent(runtime, event);

        if (event.type === "message_end") runtime.status = "completed";
        if (event.type === "error") {
          runtime.status = event.data.errorType === "canceled" ? "canceled" : "failed";
        }
      }

      if (runtime.status === "running") {
        runtime.status = runtime.abortController.signal.aborted ? "canceled" : "failed";
        this.appendEvent(runtime, {
          type: "error",
          data: {
            errorType: runtime.status,
            message: runtime.status === "canceled" ? "Agent 调用已取消" : "对话流意外结束，请重试"
          }
        });
      }
    } catch (error) {
      runtime.status = runtime.abortController.signal.aborted ? "canceled" : "failed";
      this.appendEvent(runtime, {
        type: "error",
        data: {
          errorType: runtime.status,
          message:
            runtime.status === "canceled"
              ? "Agent 调用已取消"
              : error instanceof Error
                ? error.message
                : "对话生成失败"
        }
      });
    } finally {
      this.cancelDisconnectAbort(runtime);
      this.notify(runtime);
      runtime.cleanupTimer = setTimeout(
        () => this.deleteStream(runtime.id),
        COMPLETED_STREAM_TTL_MS
      );
      runtime.cleanupTimer.unref?.();
    }
  }

  private appendEvent(runtime: ChatStreamRuntime, event: ChatStreamEvent): void {
    runtime.events.push({ id: runtime.nextEventId, type: event.type, data: event.data });
    runtime.nextEventId += 1;
    this.notify(runtime);
  }

  private notify(runtime: ChatStreamRuntime): void {
    runtime.version += 1;
    for (const resolve of runtime.waiters) resolve();
    runtime.waiters.clear();
  }

  /** 注册 waiter 后再次比较版本，封住“检查无事件”和“开始等待”之间的竞态窗口。 */
  private waitForUpdate(
    runtime: ChatStreamRuntime,
    observedVersion: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (runtime.version !== observedVersion || runtime.status !== "running" || signal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const done = () => {
        runtime.waiters.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      runtime.waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });

      if (runtime.version !== observedVersion || runtime.status !== "running" || signal?.aborted) {
        done();
      }
    });
  }

  private scheduleDisconnectAbort(runtime: ChatStreamRuntime): void {
    // 持久会话的数据库 Turn 是权威状态；页面刷新或设备断网不能等价为用户取消。
    // 临时会话没有恢复载体，仍保留宽限期止损，避免无人消费的生成无限运行。
    if (runtime.payload.sessionId) return;
    if (runtime.status !== "running" || runtime.subscribers > 0 || runtime.disconnectTimer) return;

    runtime.disconnectTimer = setTimeout(() => {
      runtime.disconnectTimer = undefined;
      if (runtime.status === "running" && runtime.subscribers === 0) {
        runtime.abortController.abort("disconnect_grace_expired");
      }
    }, DISCONNECT_GRACE_MS);
    runtime.disconnectTimer.unref?.();
  }

  private cancelDisconnectAbort(runtime: ChatStreamRuntime): void {
    if (!runtime.disconnectTimer) return;
    clearTimeout(runtime.disconnectTimer);
    runtime.disconnectTimer = undefined;
  }

  private deleteStream(streamId: string): void {
    const runtime = this.streams.get(streamId);
    if (!runtime) return;
    this.cancelDisconnectAbort(runtime);
    this.notify(runtime);
    this.streams.delete(streamId);
  }

  private requireOwnedStream(streamId: string, userId: string): ChatStreamRuntime {
    const runtime = this.streams.get(streamId);
    // 未找到和无权限统一返回 404，避免泄露其他成员正在运行的 streamId。
    if (!runtime || runtime.userId !== userId) {
      throw new AppError(ErrorCodes.common.notFound, "chat stream not found", HttpStatus.NOT_FOUND);
    }
    return runtime;
  }

  private normalizeCursor(value: number): number {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}
