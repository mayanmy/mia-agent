import * as assert from "node:assert/strict";

import { McpRuntimeToolConfig } from "./dto/mcp-runtime.dto";
import { McpToolExecutor } from "./mcp-tool.executor";

function makeConfig(overrides: Partial<McpRuntimeToolConfig> = {}): McpRuntimeToolConfig {
  return {
    serverId: "server-1",
    toolId: "tool-1",
    runtimeId: "mcp_tool-1",
    remoteName: "echo",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false
    },
    schemaHash: "schema-1",
    maxResponseBytes: 100_000,
    maxOutputChars: 20_000,
    maxConcurrency: 1,
    client: {
      serverId: "server-1",
      endpoint: "http://127.0.0.1:3000/mcp",
      authType: "none",
      authConfig: {},
      allowPrivateNetwork: true,
      connectTimeoutMs: 1_000,
      toolTimeoutMs: 1_000
    },
    ...overrides
  };
}

export const tests = [
  {
    name: "McpToolExecutor validates arguments before opening a connection",
    run: async () => {
      let clientCreated = false;
      const executor = new McpToolExecutor({
        create: () => {
          clientCreated = true;
          throw new Error("should not connect");
        }
      } as never);

      await assert.rejects(
        executor.execute(makeConfig(), {}),
        (error: unknown) =>
          error instanceof Error &&
          "errorType" in error &&
          error.errorType === "mcp_invalid_arguments"
      );
      assert.equal(clientCreated, false);
    }
  },
  {
    name: "McpToolExecutor enforces server concurrency and adapts structured output",
    run: async () => {
      let active = 0;
      let maxActive = 0;
      const executor = new McpToolExecutor({
        create: () => ({
          connect: async () => ({}),
          callTool: async (_name: string, args: Record<string, unknown>) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            active -= 1;
            return { content: [], structuredContent: { echoed: args.text }, isError: false };
          },
          close: async () => undefined
        })
      } as never);

      const outputs = await Promise.all([
        executor.execute(makeConfig(), { text: "first" }),
        executor.execute(makeConfig(), { text: "second" })
      ]);

      assert.equal(maxActive, 1);
      assert.deepEqual(outputs, [{ echoed: "first" }, { echoed: "second" }]);
    }
  },
  {
    name: "McpToolExecutor retries only a transient connection failure",
    run: async () => {
      let connectCount = 0;
      let callCount = 0;
      const executor = new McpToolExecutor({
        create: () => ({
          connect: async () => {
            connectCount += 1;
            if (connectCount === 1) throw new Error("ECONNRESET while connecting");
          },
          callTool: async () => {
            callCount += 1;
            return { content: [{ type: "text", text: "ok" }], isError: false };
          },
          close: async () => undefined
        })
      } as never);

      assert.equal(await executor.execute(makeConfig(), { text: "retry" }), "ok");
      assert.equal(connectCount, 2);
      assert.equal(callCount, 1);
    }
  },
  {
    name: "McpToolExecutor maps protocol tool errors and truncates oversized context output",
    run: async () => {
      let callCount = 0;
      const executor = new McpToolExecutor({
        create: () => ({
          connect: async () => ({}),
          callTool: async () => {
            callCount += 1;
            return callCount === 1
              ? { content: [{ type: "text", text: "remote failed" }], isError: true }
              : { content: [], structuredContent: { text: "x".repeat(500) }, isError: false };
          },
          close: async () => undefined
        })
      } as never);

      await assert.rejects(
        executor.execute(makeConfig(), { text: "error" }),
        (error: unknown) =>
          error instanceof Error && "errorType" in error && error.errorType === "mcp_tool_error"
      );
      const output = await executor.execute(makeConfig({ maxOutputChars: 100 }), {
        text: "truncate"
      });
      assert.equal(typeof output, "object");
      assert.equal((output as Record<string, unknown>).truncated, true);
    }
  },
  {
    name: "McpToolExecutor propagates timeout and upstream cancellation with stable error types",
    run: async () => {
      const executor = new McpToolExecutor({
        create: () => ({
          connect: async () => ({}),
          callTool: async (_name: string, _args: unknown, signal?: AbortSignal) =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true }
              );
            }),
          close: async () => undefined
        })
      } as never);

      await assert.rejects(
        executor.execute(makeConfig({ client: { ...makeConfig().client, toolTimeoutMs: 15 } }), {
          text: "timeout"
        }),
        (error: unknown) =>
          error instanceof Error && "errorType" in error && error.errorType === "mcp_tool_timeout"
      );

      const controller = new AbortController();
      const pending = executor.execute(makeConfig(), { text: "cancel" }, controller.signal);
      setTimeout(() => controller.abort(), 10);
      await assert.rejects(
        pending,
        (error: unknown) =>
          error instanceof Error && "errorType" in error && error.errorType === "canceled"
      );
    }
  }
];
