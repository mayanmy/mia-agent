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
              { id: "message-3", role: "ASSISTANT", content: "最新", createdAt: newest },
              { id: "message-2", role: "USER", content: "中间", createdAt: middle },
              { id: "message-1", role: "ASSISTANT", content: "最早", createdAt: oldest }
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
  }
];
