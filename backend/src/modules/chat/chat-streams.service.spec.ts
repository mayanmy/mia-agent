import * as assert from "node:assert/strict";

import { ChatStreamsService, StoredChatStreamEvent } from "./chat-streams.service";
import { ChatStreamEvent } from "./dto/chat.dto";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function collect(
  iterable: AsyncIterable<StoredChatStreamEvent>
): Promise<StoredChatStreamEvent[]> {
  const events: StoredChatStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

export const tests = [
  {
    name: "ChatStreamsService replays only missed events after a short disconnect",
    run: async () => {
      const continueGeneration = deferred();
      const chatService = {
        streamCompletion: async function* (): AsyncIterable<ChatStreamEvent> {
          yield { type: "message_start", data: { runId: "run-1" } };
          yield { type: "token", data: { content: "你" } };
          await continueGeneration.promise;
          yield { type: "token", data: { content: "好" } };
          yield { type: "message_end", data: { content: "你好" } };
        }
      };
      const service = new ChatStreamsService(chatService as never);
      const { streamId } = service.createStream(
        { agentId: "agent-1", message: "hello" },
        { requestId: "request-1", userId: "user-1" }
      );
      const firstSubscription = service.subscribe(streamId, "user-1", 0)[Symbol.asyncIterator]();

      const first = await firstSubscription.next();
      const second = await firstSubscription.next();
      assert.equal(first.value?.id, 1);
      assert.equal(second.value?.id, 2);
      await firstSubscription.return?.();

      continueGeneration.resolve();
      const resumed = await collect(service.subscribe(streamId, "user-1", 2));
      assert.deepEqual(
        resumed.map((event) => [event.id, event.type, event.data.content]),
        [
          [3, "token", "好"],
          [4, "message_end", "你好"]
        ]
      );
      service.onModuleDestroy();
    }
  },
  {
    name: "ChatStreamsService cancels the detached model task on explicit user stop",
    run: async () => {
      const chatService = {
        streamCompletion: async function* (
          _payload: unknown,
          signal?: AbortSignal
        ): AsyncIterable<ChatStreamEvent> {
          yield { type: "message_start", data: { runId: "run-2" } };
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          yield {
            type: "error",
            data: { errorType: "canceled", message: "Agent 调用已取消" }
          };
        }
      };
      const service = new ChatStreamsService(chatService as never);
      const { streamId } = service.createStream(
        { agentId: "agent-1", message: "hello" },
        { requestId: "request-2", userId: "user-1" }
      );
      const subscription = service.subscribe(streamId, "user-1", 0)[Symbol.asyncIterator]();

      assert.equal((await subscription.next()).value?.type, "message_start");
      service.cancelStream(streamId, "user-1");
      const canceled = await subscription.next();
      assert.equal(canceled.value?.type, "error");
      assert.equal(canceled.value?.data.errorType, "canceled");
      assert.equal((await subscription.next()).done, true);
      service.onModuleDestroy();
    }
  }
];
