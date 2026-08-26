import * as assert from "node:assert/strict";

import { McpApprovalMode, McpAuthType, McpHealthStatus, McpTransport } from "@prisma/client";

import { McpService } from "./mcp.service";

function makeServer() {
  const now = new Date("2026-08-11T00:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test MCP",
    slug: "test-mcp",
    description: "",
    transport: McpTransport.STREAMABLE_HTTP,
    endpoint: "http://127.0.0.1:3000/mcp",
    authType: McpAuthType.NONE,
    authConfig: {},
    secretId: null,
    enabled: true,
    allowPrivateNetwork: true,
    approvalMode: McpApprovalMode.AUTO,
    connectTimeoutMs: 10_000,
    toolTimeoutMs: 30_000,
    maxResponseBytes: 1_000_000,
    maxOutputChars: 20_000,
    maxConcurrency: 3,
    healthStatus: McpHealthStatus.UNKNOWN,
    negotiatedProtocolVersion: null,
    serverInfo: null,
    capabilities: null,
    lastConnectedAt: null,
    lastDiscoveredAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdByUserId: "22222222-2222-4222-8222-222222222222",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    secret: null,
    oauthAuthorization: null,
    _count: { tools: 1 }
  };
}

export const tests = [
  {
    name: "McpService sync keeps stable runtime IDs and creates new tools disabled",
    run: async () => {
      const server = makeServer();
      const creates: Array<Record<string, unknown>> = [];
      const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
      const updateMany: Array<Record<string, unknown>> = [];
      const existing = {
        id: "33333333-3333-4333-8333-333333333333",
        serverId: server.id,
        remoteName: "echo",
        runtimeId: "mcp_stable-runtime-id",
        schemaHash: "old-hash"
      };
      const transactionClient = {
        mcpServerTool: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            creates.push(data);
            return data;
          },
          update: async (args: { where: unknown; data: Record<string, unknown> }) => {
            updates.push(args);
            return args.data;
          },
          updateMany: async (args: Record<string, unknown>) => {
            updateMany.push(args);
            return { count: 0 };
          }
        },
        mcpServer: { update: async () => server },
        mcpSyncRun: { update: async () => ({}) }
      };
      const prisma = {
        mcpServer: { findFirst: async () => server },
        mcpSyncRun: { create: async () => ({ id: "sync-1" }) },
        mcpServerTool: { findMany: async () => [existing] },
        $transaction: async (value: unknown) =>
          typeof value === "function"
            ? (value as (tx: typeof transactionClient) => Promise<unknown>)(transactionClient)
            : Promise.all(value as Promise<unknown>[])
      };
      const client = {
        connect: async () => ({ protocolVersion: "2026-07-28" }),
        listTools: async () => [
          { name: "echo", description: "updated", inputSchema: { type: "object" } },
          { name: "weather", description: "new", inputSchema: { type: "object" } }
        ],
        close: async () => undefined
      };
      const service = new McpService(
        prisma as never,
        { create: () => client } as never,
        {} as never
      );

      const result = await service.syncTools(server.id);

      assert.equal(result.status, "completed");
      assert.equal(result.toolCount, 2);
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0].where, { id: existing.id });
      assert.equal(creates.length, 1);
      assert.equal(creates[0].remoteName, "weather");
      assert.equal(creates[0].enabled, false);
      assert.match(String(creates[0].runtimeId), /^mcp_[0-9a-f-]{36}$/);
      assert.equal(updateMany.length, 1);
    }
  },
  {
    name: "McpService failed sync records failure without mutating tool snapshots",
    run: async () => {
      const server = makeServer();
      let toolSnapshotTouched = false;
      const statusWrites: Array<Record<string, unknown>> = [];
      const prisma = {
        mcpServer: {
          findFirst: async () => server,
          update: async ({ data }: { data: Record<string, unknown> }) => {
            statusWrites.push(data);
            return server;
          }
        },
        mcpSyncRun: {
          create: async () => ({ id: "sync-failed" }),
          update: async ({ data }: { data: Record<string, unknown> }) => {
            statusWrites.push(data);
            return {};
          }
        },
        mcpServerTool: {
          findMany: async () => {
            toolSnapshotTouched = true;
            return [];
          }
        },
        $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations)
      };
      const service = new McpService(
        prisma as never,
        {
          create: () => {
            throw new Error("authentication failed");
          }
        } as never,
        {} as never
      );

      const result = await service.syncTools(server.id);

      assert.equal(result.status, "failed");
      assert.equal(toolSnapshotTouched, false);
      assert.ok(statusWrites.some((write) => write.status === "FAILED"));
    }
  }
];
