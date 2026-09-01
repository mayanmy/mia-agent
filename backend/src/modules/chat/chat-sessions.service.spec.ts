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
                createdAt: newest
              },
              { id: "message-2", role: "USER", content: "中间", metadata: null, createdAt: middle },
              { id: "message-1", role: "ASSISTANT", content: "最早", metadata: null, createdAt: oldest }
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
