import * as assert from "node:assert/strict";

import { McpApprovalMode, McpToolApprovalStatus } from "@prisma/client";

import { McpApprovalService } from "./mcp-approval.service";

type ApprovalRecord = {
  id: string;
  runtimeId: string;
  runId: string;
  toolCallId: string | null;
  userId: string;
  agentId: string;
  inputHash: string;
  status: McpToolApprovalStatus;
  expiresAt: Date;
  decidedAt: Date | null;
};

export const tests = [
  {
    name: "McpApprovalService binds approval to owner and consumes it only once",
    run: async () => {
      process.env.MIA_SECRET_KEY = process.env.MIA_SECRET_KEY || "mcp-approval-test-secret";
      let record: ApprovalRecord | undefined;
      const prisma = {
        mcpServerTool: {
          findUnique: async () => ({
            id: "11111111-1111-4111-8111-111111111111",
            serverId: "22222222-2222-4222-8222-222222222222",
            runtimeId: "mcp_weather",
            enabled: true,
            approvalMode: McpApprovalMode.CONFIRM,
            server: { approvalMode: McpApprovalMode.AUTO, enabled: true, deletedAt: null }
          })
        },
        mcpToolApproval: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            record = {
              id: "33333333-3333-4333-8333-333333333333",
              runtimeId: String(data.runtimeId),
              runId: String(data.runId),
              toolCallId: String(data.toolCallId),
              userId: String(data.userId),
              agentId: String(data.agentId),
              inputHash: String(data.inputHash),
              status: McpToolApprovalStatus.PENDING,
              expiresAt: data.expiresAt as Date,
              decidedAt: null
            };
            return record;
          },
          findUnique: async () => record ?? null,
          findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
            record?.id === where.id && record.userId === where.userId ? record : null,
          updateMany: async ({
            where,
            data
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (!record || (where.id && where.id !== record.id)) return { count: 0 };
            if (where.userId && where.userId !== record.userId) return { count: 0 };
            if (where.runtimeId && where.runtimeId !== record.runtimeId) return { count: 0 };
            if (where.runId && where.runId !== record.runId) return { count: 0 };
            if (where.agentId && where.agentId !== record.agentId) return { count: 0 };
            if (where.inputHash && where.inputHash !== record.inputHash) return { count: 0 };
            if (where.status && where.status !== record.status) return { count: 0 };
            record = { ...record, ...data } as ApprovalRecord;
            return { count: 1 };
          }
        }
      };
      const service = new McpApprovalService(prisma as never);
      const input = { city: "Shenzhen" };
      const approval = await service.createRequest({
        runtimeId: "mcp_weather",
        input,
        runId: "44444444-4444-4444-8444-444444444444",
        toolCallId: "call-1",
        userId: "55555555-5555-4555-8555-555555555555",
        agentId: "66666666-6666-4666-8666-666666666666"
      });

      await assert.rejects(() =>
        service.approve(approval.id, "77777777-7777-4777-8777-777777777777")
      );
      const waiting = service.waitForDecision(approval.id);
      await service.approve(approval.id, "55555555-5555-4555-8555-555555555555");
      assert.deepEqual(await waiting, { approved: true, status: "APPROVED" });

      const consume = {
        approvalId: approval.id,
        runtimeId: "mcp_weather",
        input,
        runId: "44444444-4444-4444-8444-444444444444",
        userId: "55555555-5555-4555-8555-555555555555",
        agentId: "66666666-6666-4666-8666-666666666666"
      };
      await service.consume(consume);
      assert.equal(record?.status, McpToolApprovalStatus.CONSUMED);
      await assert.rejects(() => service.consume(consume));
    }
  }
];
