import * as assert from "node:assert/strict";
import { ChatSessionStatus } from "@prisma/client";

import { ChatSessionsService } from "./chat-sessions.service";

export const tests = [
  {
    name: "ChatSessionsService returns message pages in chronological order with a cursor",
    run: async () => {
      const queryCalls: Array<Record<string, unknown>> = [];
      const oldest = new Date("2026-07-21T01:00:00.000Z");
      const middle = new Date("2026-07-21T01:01:00.000Z");
      const newest = new Date("2026-07-21T01:02:00.000Z");
      const prisma = {
        chatSession: {
          findFirst: async () => ({
            id: "session-id",
            agentId: "agent-id",
            userId: "user-id",
            status: ChatSessionStatus.ACTIVE
          })
        },
        chatSessionMessage: {
          findMany: async (query: Record<string, unknown>) => {
            queryCalls.push(query);
            return [
              {
                id: "message-3",
                role: "ASSISTANT",
                content: "最新",
                metadata: { requestId: "request-3", elapsedMs: 320 },
                feedbacks: [],
                createdAt: newest
              },
              {
                id: "message-2",
                role: "USER",
                content: "中间",
                metadata: null,
                feedbacks: [],
                createdAt: middle
              },
              {
                id: "message-1",
                role: "ASSISTANT",
                content: "最早",
                metadata: null,
                feedbacks: [],
                createdAt: oldest
              }
            ];
          }
        }
      };
      const service = new ChatSessionsService(prisma as never);

      const page = await service.getMessagePage(
        "session-id",
        { agentId: "agent-id", userId: "user-id" },
        { pageSize: "2" }
      );

      assert.deepEqual(
        page.list.map((item) => item.content),
        ["中间", "最新"]
      );
      assert.equal(page.hasMore, true);
      assert.ok(page.nextBefore);
      assert.equal(queryCalls[0].take, 3);
      assert.deepEqual(page.list[1]?.metadata, { requestId: "request-3", elapsedMs: 320 });
    }
  },
  {
    name: "ChatSessionsService persists assistant runtime metadata",
    run: async () => {
      let createdData: Record<string, unknown> | undefined;
      const transaction = {
        chatSessionMessage: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createdData = data;
            return { id: "message-id" };
          }
        },
        chatSession: {
          update: async () => undefined,
          updateMany: async () => undefined
        }
      };
      const prisma = {
        $transaction: async (callback: (client: typeof transaction) => Promise<void>) =>
          callback(transaction)
      };
      const service = new ChatSessionsService(prisma as never);

      await service.appendMessage("session-id", "ASSISTANT" as never, "回答", {
        requestId: "request-id",
        modelName: "model-a",
        retrievalEvents: []
      });

      assert.deepEqual(createdData?.metadata, {
        requestId: "request-id",
        modelName: "model-a",
        retrievalEvents: []
      });
    }
  },
  {
    name: "ChatSessionsService does not reveal a session owned by another user",
    run: async () => {
      const prisma = {
        chatSession: {
          findFirst: async () => null
        }
      };
      const service = new ChatSessionsService(prisma as never);

      await assert.rejects(
        () =>
          service.getMessagePage(
            "other-user-session",
            { agentId: "agent-id", userId: "user-id" },
            {}
          ),
        /chat session not found/u
      );
    }
  },
  {
    name: "ChatSessionsService upserts feedback only for an owned assistant message",
    run: async () => {
      let upsertQuery: Record<string, unknown> | undefined;
      const prisma = {
        chatSessionMessage: {
          findFirst: async () => ({ id: "assistant-message" })
        },
        chatMessageFeedback: {
          upsert: async (query: Record<string, unknown>) => {
            upsertQuery = query;
            return {
              rating: "DOWN",
              reason: "引用不准确",
              reasonCodes: ["other"],
              comment: "引用不准确",
              correctedAnswer: null
            };
          }
        }
      };
      const service = new ChatSessionsService(prisma as never);

      const feedback = await service.upsertMessageFeedback("assistant-message", "user-id", {
        rating: "DOWN",
        reason: " 引用不准确 "
      });

      assert.deepEqual(feedback, {
        messageId: "assistant-message",
        rating: "DOWN",
        reason: "引用不准确",
        reasonCodes: ["other"],
        comment: "引用不准确",
        correctedAnswer: null
      });
      assert.deepEqual(upsertQuery?.where, {
        messageId_userId: { messageId: "assistant-message", userId: "user-id" }
      });
      assert.deepEqual((upsertQuery?.create as Record<string, unknown>).reasonCodes, ["other"]);
    }
  },
  {
    name: "ChatSessionsService rejects feedback for a message outside the current user session",
    run: async () => {
      const prisma = {
        chatSessionMessage: { findFirst: async () => null }
      };
      const service = new ChatSessionsService(prisma as never);

      await assert.rejects(
        () => service.upsertMessageFeedback("other-message", "user-id", { rating: "UP" }),
        /chat message not found/u
      );
    }
  },
  {
    name: "ChatSessionsService allocates stable turn sequences and assistant placeholders",
    run: async () => {
      let nextTurnSequence = 1n;
      const turns = new Map<string, Record<string, unknown>>();
      const messages: Array<Record<string, unknown>> = [];
      const transaction = {
        chatSession: {
          update: async (query: {
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            if (query.data.nextTurnSequence) {
              nextTurnSequence += 1n;
              return { nextTurnSequence };
            }
            return {};
          },
          updateMany: async () => undefined
        },
        chatTurn: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const turn = {
              id: `turn-${String(data.sequence)}`,
              createdAt: new Date(`2026-09-23T00:00:0${String(data.sequence)}.000Z`),
              ...data
            };
            turns.set(String(data.clientMessageId), turn);
            return turn;
          },
          update: async ({
            where,
            data
          }: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => {
            const turn = [...turns.values()].find((item) => item.id === where.id)!;
            Object.assign(turn, data);
            return turn;
          }
        },
        chatSessionMessage: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const message = { id: `message-${messages.length + 1}`, ...data };
            messages.push(message);
            return message;
          }
        }
      };
      const prisma = {
        chatTurn: { findUnique: async () => null },
        $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      };
      const service = new ChatSessionsService(prisma as never);

      const first = await service.startTurn("session-id", "client-1", "手机消息");
      const second = await service.startTurn("session-id", "client-2", "电脑消息");

      assert.equal(first.sequence, 1n);
      assert.equal(second.sequence, 2n);
      assert.deepEqual(
        messages.map((item) => [item.turnSequence, item.turnPosition, item.role]),
        [
          [1n, 0, "USER"],
          [1n, 1, "ASSISTANT"],
          [2n, 0, "USER"],
          [2n, 1, "ASSISTANT"]
        ]
      );
    }
  },
  {
    name: "ChatSessionsService only deletes archived sessions",
    run: async () => {
      let deletedSessionId: string | null = null;
      const prisma = {
        chatSession: {
          findFirst: async () => ({
            id: "archived-session",
            agentId: "agent-id",
            userId: "user-id",
            status: ChatSessionStatus.ARCHIVED
          }),
          delete: async ({ where }: { where: { id: string } }) => {
            deletedSessionId = where.id;
          }
        }
      };
      const service = new ChatSessionsService(prisma as never);

      await service.deleteSession("archived-session", { agentId: "agent-id", userId: "user-id" });
      assert.equal(deletedSessionId, "archived-session");
    }
  }
];
