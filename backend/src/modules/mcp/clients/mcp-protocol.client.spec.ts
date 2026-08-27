import * as assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";

import { McpProtocolClient } from "./mcp-protocol.client";

type TestMcpServer = {
  endpoint: string;
  wasSlowToolCanceled: () => boolean;
  close: () => Promise<void>;
};

/** 启动真实本地 HTTP Server，确保测试覆盖 Transport，而不只是 SDK 内存消息通道。 */
async function startTestMcpServer(): Promise<TestMcpServer> {
  let slowToolCanceled = false;
  const handler = createMcpHandler(() => {
    const server = new Server(
      { name: "mia-mcp-m0-test", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // 人工拆成两页，用于验证 Client.listTools() 会聚合完整结果并防止分页游标泄漏到业务层。
    server.setRequestHandler("tools/list", async (request) => {
      if (!request.params?.cursor) {
        return {
          tools: [
            {
              name: "echo",
              title: "Echo",
              description: "返回输入文本",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
                additionalProperties: false
              },
              outputSchema: {
                type: "object",
                properties: { echoed: { type: "string" } },
                required: ["echoed"],
                additionalProperties: false
              }
            }
          ],
          nextCursor: "page-2"
        };
      }

      return {
        tools: [
          {
            name: "slow",
            description: "等待直到完成或取消",
            inputSchema: { type: "object", additionalProperties: false }
          }
        ]
      };
    });

    server.setRequestHandler("tools/call", async (request, context) => {
      if (request.params.name === "echo") {
        const text = String(request.params.arguments?.text ?? "");
        return {
          content: [{ type: "text", text }],
          structuredContent: { echoed: text }
        };
      }

      if (request.params.name === "slow") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          context.mcpReq.signal.addEventListener(
            "abort",
            () => {
              slowToolCanceled = true;
              clearTimeout(timer);
              reject(new DOMException("MCP Tool 已取消", "AbortError"));
            },
            { once: true }
          );
        });
        return { content: [{ type: "text", text: "finished" }] };
      }

      return {
        content: [{ type: "text", text: "unknown tool" }],
        isError: true
      };
    });

    server.setRequestHandler("resources/list", async () => ({
      resources: [
        {
          uri: "mia://guides/weather",
          name: "weather-guide",
          title: "天气穿搭指南",
          description: "适合导入知识库的文本资源",
          mimeType: "text/markdown"
        }
      ]
    }));

    server.setRequestHandler("resources/templates/list", async () => ({
      resourceTemplates: [
        {
          uriTemplate: "mia://guides/{topic}",
          name: "guide-template",
          description: "按主题读取指南",
          mimeType: "text/markdown"
        }
      ]
    }));

    server.setRequestHandler("resources/read", async (request) => ({
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/markdown",
          text: "# 天气穿搭\n\n下雨时请携带雨具。"
        }
      ]
    }));

    server.setRequestHandler("prompts/list", async () => ({
      prompts: [
        {
          name: "review_contract",
          title: "合同审查",
          description: "按审查立场生成合同审查步骤",
          arguments: [{ name: "position", description: "审查立场", required: true }]
        }
      ]
    }));

    server.setRequestHandler("prompts/get", async (request) => ({
      description: "合同审查方法",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `请站在${request.params.arguments?.position ?? "采购方"}立场审查合同。`
          }
        }
      ]
    }));

    return server;
  });
  const nodeHandler = toNodeHandler(handler);
  const httpServer = createServer((request, response) => {
    void nodeHandler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    wasSlowToolCanceled: () => slowToolCanceled,
    close: async () => {
      await handler.close();
      await closeHttpServer(httpServer);
    }
  };
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

export const tests = [
  {
    name: "McpProtocolClient connects, aggregates tools and calls a tool over Streamable HTTP",
    run: async () => {
      const testServer = await startTestMcpServer();
      const client = new McpProtocolClient({
        endpoint: testServer.endpoint,
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 2_000
      });

      try {
        const connection = await client.connect();
        assert.equal(connection.protocolEra, "modern");
        assert.equal(connection.protocolVersion, "2026-07-28");

        const tools = await client.listTools();
        assert.deepEqual(
          tools.map((tool) => tool.name),
          ["echo", "slow"]
        );

        const result = await client.callTool("echo", { text: "hello MCP" });
        assert.equal(result.isError, false);
        assert.deepEqual(result.structuredContent, { echoed: "hello MCP" });
        assert.deepEqual(result.content, [{ type: "text", text: "hello MCP" }]);
      } finally {
        await client.close();
        await client.close();
        await testServer.close();
      }
    }
  },
  {
    name: "McpProtocolClient discovers resource catalogs and reads text content",
    run: async () => {
      const testServer = await startTestMcpServer();
      const client = new McpProtocolClient({
        endpoint: testServer.endpoint,
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 2_000
      });

      try {
        await client.connect();
        const catalog = await client.listResources();
        assert.equal(catalog.resources[0]?.uri, "mia://guides/weather");
        assert.equal(catalog.templates[0]?.uriTemplate, "mia://guides/{topic}");

        const resource = await client.readResource("mia://guides/weather");
        assert.equal(resource.contents[0]?.mimeType, "text/markdown");
        assert.match(String(resource.contents[0]?.text), /下雨时请携带雨具/);
      } finally {
        await client.close();
        await testServer.close();
      }
    }
  },
  {
    name: "McpProtocolClient discovers Prompts and renders messages with arguments",
    run: async () => {
      const testServer = await startTestMcpServer();
      const client = new McpProtocolClient({
        endpoint: testServer.endpoint,
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 2_000
      });

      try {
        await client.connect();
        const catalog = await client.listPrompts();
        assert.equal(catalog.prompts[0]?.name, "review_contract");

        const prompt = await client.getPrompt("review_contract", { position: "采购方" });
        assert.equal(prompt.description, "合同审查方法");
        assert.match(JSON.stringify(prompt.messages[0]?.content), /采购方/);
      } finally {
        await client.close();
        await testServer.close();
      }
    }
  },
  {
    name: "McpProtocolClient propagates AbortSignal to the Streamable HTTP tool request",
    run: async () => {
      const testServer = await startTestMcpServer();
      const client = new McpProtocolClient({
        endpoint: testServer.endpoint,
        connectTimeoutMs: 2_000,
        requestTimeoutMs: 10_000
      });

      try {
        await client.connect();
        const controller = new AbortController();
        const pendingCall = client.callTool("slow", {}, controller.signal);
        setTimeout(() => controller.abort(), 30);

        await assert.rejects(pendingCall, (error: unknown) => {
          return error instanceof Error && error.name === "AbortError";
        });
        assert.equal(await waitUntil(testServer.wasSlowToolCanceled, 1_000), true);
      } finally {
        await client.close();
        await testServer.close();
      }
    }
  },
  {
    name: "McpProtocolClient rejects calls before connecting",
    run: async () => {
      const client = new McpProtocolClient({ endpoint: "http://127.0.0.1:1/mcp" });

      await assert.rejects(client.listTools(), /MCP Client 尚未连接/);
    }
  }
];
