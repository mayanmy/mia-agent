import * as assert from "node:assert/strict";

import { HttpToolRuntimeConfig } from "./dto/http-tool.dto";
import { HttpToolExecutor } from "./http/http-tool.executor";
import { ToolsService } from "./tools.service";

const configuredHttpTool: HttpToolRuntimeConfig = {
  id: "tool-1",
  method: "GET",
  baseUrl: "http://127.0.0.1:9000",
  path: "/orders/{orderId}",
  parameters: [
    { name: "orderId", description: "订单号", type: "string", location: "path", required: true },
    {
      name: "verbose",
      targetName: "include_items",
      description: "返回详情",
      type: "boolean",
      location: "query",
      required: false
    }
  ],
  fixedHeaders: [{ name: "X-Tenant-ID", value: "team-a" }],
  authType: "bearer",
  authHeaderName: null,
  secret: "secret-token",
  authConfig: null,
  credentials: {},
  tokenCacheKey: "tool-1:1",
  timeoutMs: 1000,
  maxResponseBytes: 10000,
  allowPrivateNetwork: true
};

export const tests = [
  {
    name: "ToolsService lists enabled builtin tools",
    run: async () => {
      const service = new ToolsService();
      const tools = await service.listTools();
      const toolIds = tools.map((tool) => tool.id);

      assert.deepEqual(toolIds, ["http_request", "calculator", "current_time"]);
      assert.ok(tools.every((tool) => tool.enabled));
    }
  },

  {
    name: "ToolsService executes calculator successfully",
    run: async () => {
      const service = new ToolsService();
      const result = await service.executeTool({
        toolId: "calculator",
        input: {
          operation: "add",
          operands: [1, 2, 3]
        }
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.output, {
        operation: "add",
        operands: [1, 2, 3],
        result: 6
      });
    }
  },
  {
    name: "ToolsService merges and executes MCP tools through the unified runtime path",
    run: async () => {
      const mcpService = {
        listRuntimeTools: async () => [
          {
            id: "mcp_weather",
            name: "Weather",
            description: "实时天气",
            enabled: true,
            inputSchema: { type: "object" }
          }
        ],
        getRuntimeToolDefinitions: async () => [
          {
            id: "mcp_weather",
            name: "Weather",
            description: "实时天气",
            enabled: true,
            inputSchema: { type: "object" }
          }
        ],
        resolveRuntimeTool: async () => ({ runtimeId: "mcp_weather" })
      };
      const mcpExecutor = {
        execute: async () => ({ temperature: 27 })
      };
      const service = new ToolsService(
        undefined,
        undefined,
        undefined,
        mcpService as never,
        mcpExecutor as never
      );

      assert.ok((await service.listTools()).some((tool) => tool.id === "mcp_weather"));
      assert.deepEqual(
        (await service.getToolDefinitions(["mcp_weather"])).map((tool) => tool.id),
        ["mcp_weather"]
      );
      const result = await service.executeTool({
        toolId: "mcp_weather",
        input: { city: "深圳" }
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.output, { temperature: 27 });
    }
  },

  {
    name: "ToolsService logs tool execution results when prisma is available",
    run: async () => {
      const writes: Array<Record<string, unknown>> = [];
      const service = new ToolsService({
        toolCallLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            writes.push(data);
            return { id: "log-1" };
          }
        }
      } as never);
      const result = await service.executeTool({
        toolCallId: "call-1",
        toolId: "calculator",
        requestId: "request-1",
        runId: "run-1",
        stepId: "step-1",
        agentId: "agent-1",
        input: {
          operation: "add",
          operands: [1, 2]
        }
      });

      assert.equal(result.ok, true);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].requestId, "request-1");
      assert.equal(writes[0].runId, "run-1");
      assert.equal(writes[0].stepId, "step-1");
      assert.equal(writes[0].agentId, "agent-1");
      assert.equal(writes[0].toolCallId, "call-1");
      assert.equal(writes[0].toolId, "calculator");
      assert.equal(writes[0].status, "completed");
    }
  },

  {
    name: "ToolsService wraps calculator failures",
    run: async () => {
      const service = new ToolsService();
      const result = await service.executeTool({
        toolId: "calculator",
        input: {
          operation: "divide",
          operands: [10, 0]
        }
      });

      assert.equal(result.ok, false);
      assert.equal(result.errorType, "invalid_tool_input");
      assert.equal(result.errorMessage, "计算器参数错误：不允许除以 0");
    }
  },

  {
    name: "ToolsService returns readable error for missing tools",
    run: async () => {
      const service = new ToolsService();
      const result = await service.executeTool({
        toolId: "missing_tool",
        input: {}
      });

      assert.equal(result.ok, false);
      assert.equal(result.errorType, "tool_not_found");
      assert.equal(result.errorMessage, "工具不存在或已停用");
    }
  },

  {
    name: "ToolsService blocks http_request to local addresses",
    run: async () => {
      const service = new ToolsService();
      const originalAllowLocalhost = process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST;
      process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST = "false";

      try {
        const result = await service.executeTool({
          toolId: "http_request",
          input: {
            url: "http://127.0.0.1:3000/private"
          }
        });

        assert.equal(result.ok, false);
        assert.equal(result.errorType, "invalid_tool_input");
        assert.equal(result.errorMessage, "HTTP 请求被安全策略拦截：目标地址不允许访问");
      } finally {
        if (originalAllowLocalhost === undefined) {
          delete process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST;
        } else {
          process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST = originalAllowLocalhost;
        }
      }
    }
  },

  {
    name: "ToolsService returns readable error for http_request parameter errors",
    run: async () => {
      const service = new ToolsService();
      const result = await service.executeTool({
        toolId: "http_request",
        input: {
          method: "GET"
        }
      });

      assert.equal(result.ok, false);
      assert.equal(result.errorType, "invalid_tool_input");
      assert.equal(result.errorMessage, "HTTP 请求参数错误：url 不能为空");
    }
  },

  {
    name: "ToolsService blocks http_request hosts outside allowlist",
    run: async () => {
      const service = new ToolsService();
      const originalAllowedHosts = process.env.TOOLS_HTTP_ALLOWED_HOSTS;
      process.env.TOOLS_HTTP_ALLOWED_HOSTS = "api.example.com";

      try {
        const result = await service.executeTool({
          toolId: "http_request",
          input: {
            url: "https://blocked.example.com/data"
          }
        });

        assert.equal(result.ok, false);
        assert.equal(result.errorType, "invalid_tool_input");
        assert.equal(result.errorMessage, "HTTP 请求被安全策略拦截：目标地址不在允许列表中");
      } finally {
        if (originalAllowedHosts === undefined) {
          delete process.env.TOOLS_HTTP_ALLOWED_HOSTS;
        } else {
          process.env.TOOLS_HTTP_ALLOWED_HOSTS = originalAllowedHosts;
        }
      }
    }
  },

  {
    name: "ToolsService allows http_request hosts in allowlist",
    run: async () => {
      const service = new ToolsService();
      const originalAllowedHosts = process.env.TOOLS_HTTP_ALLOWED_HOSTS;
      const originalFetch = globalThis.fetch;
      process.env.TOOLS_HTTP_ALLOWED_HOSTS = "api.example.com,*.trusted.example.com";
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }) as typeof fetch;

      try {
        const result = await service.executeTool({
          toolId: "http_request",
          input: {
            url: "https://service.trusted.example.com/data"
          }
        });

        assert.equal(result.ok, true);
        assert.ok(
          result.output && typeof result.output === "object" && !Array.isArray(result.output)
        );
        assert.equal(result.output.url, "https://service.trusted.example.com/data");
        assert.equal(result.output.method, "GET");
        assert.equal(result.output.status, 200);
        assert.equal(result.output.ok, true);
        assert.equal(result.output.contentType, "application/json");
        assert.deepEqual(result.output.body, {
          ok: true
        });
      } finally {
        globalThis.fetch = originalFetch;

        if (originalAllowedHosts === undefined) {
          delete process.env.TOOLS_HTTP_ALLOWED_HOSTS;
        } else {
          process.env.TOOLS_HTTP_ALLOWED_HOSTS = originalAllowedHosts;
        }
      }
    }
  },

  {
    name: "ToolsService allows http_request to localhost when explicitly enabled and allowlisted",
    run: async () => {
      const service = new ToolsService();
      const originalAllowedHosts = process.env.TOOLS_HTTP_ALLOWED_HOSTS;
      const originalMiaAllowedHosts = process.env.MIA_TOOLS_HTTP_ALLOWED_HOSTS;
      const originalAllowLocalhost = process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST;
      const originalFetch = globalThis.fetch;
      delete process.env.TOOLS_HTTP_ALLOWED_HOSTS;
      process.env.MIA_TOOLS_HTTP_ALLOWED_HOSTS = "localhost:5174";
      process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST = "true";
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }) as typeof fetch;

      try {
        const result = await service.executeTool({
          toolId: "http_request",
          input: {
            url: "http://localhost:5174/api/v1/agents?page=1&pageSize=20"
          }
        });

        assert.equal(result.ok, true);
        assert.ok(
          result.output && typeof result.output === "object" && !Array.isArray(result.output)
        );
        assert.equal(result.output.url, "http://localhost:5174/api/v1/agents?page=1&pageSize=20");
        assert.deepEqual(result.output.body, {
          data: []
        });
      } finally {
        globalThis.fetch = originalFetch;

        if (originalAllowedHosts === undefined) {
          delete process.env.TOOLS_HTTP_ALLOWED_HOSTS;
        } else {
          process.env.TOOLS_HTTP_ALLOWED_HOSTS = originalAllowedHosts;
        }

        if (originalMiaAllowedHosts === undefined) {
          delete process.env.MIA_TOOLS_HTTP_ALLOWED_HOSTS;
        } else {
          process.env.MIA_TOOLS_HTTP_ALLOWED_HOSTS = originalMiaAllowedHosts;
        }

        if (originalAllowLocalhost === undefined) {
          delete process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST;
        } else {
          process.env.MIA_TOOLS_HTTP_ALLOW_LOCALHOST = originalAllowLocalhost;
        }
      }
    }
  },

  {
    name: "ToolsService times out http_request",
    run: async () => {
      const service = new ToolsService();
      const originalAllowedHosts = process.env.TOOLS_HTTP_ALLOWED_HOSTS;
      const originalFetch = globalThis.fetch;

      process.env.TOOLS_HTTP_ALLOWED_HOSTS = "example.com";
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("The operation was aborted.");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        });
      }) as typeof fetch;

      try {
        const result = await service.executeTool({
          toolId: "http_request",
          input: {
            url: "https://example.com/slow",
            timeoutMs: 1
          }
        });

        assert.equal(result.ok, false);
        assert.equal(result.errorType, "canceled");
        assert.equal(result.errorMessage, "工具调用超时或已取消");
      } finally {
        globalThis.fetch = originalFetch;

        if (originalAllowedHosts === undefined) {
          delete process.env.TOOLS_HTTP_ALLOWED_HOSTS;
        } else {
          process.env.TOOLS_HTTP_ALLOWED_HOSTS = originalAllowedHosts;
        }
      }
    }
  },

  {
    name: "HttpToolExecutor builds configured path query headers and bearer auth",
    run: async () => {
      const executor = new HttpToolExecutor();
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      let requestedHeaders = new Headers();
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedHeaders = new Headers(init?.headers);
        return new Response(
          JSON.stringify({ id: "ORD 1", token: "secret-token", note: "secret-token suffix" }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }) as typeof fetch;

      try {
        const output = await executor.execute(configuredHttpTool, {
          orderId: "ORD 1",
          verbose: true
        });
        assert.equal(requestedUrl, "http://127.0.0.1:9000/orders/ORD%201?include_items=true");
        assert.equal(requestedHeaders.get("x-tenant-id"), "team-a");
        assert.equal(requestedHeaders.get("authorization"), "Bearer secret-token");
        assert.ok(output && typeof output === "object" && !Array.isArray(output));
        assert.deepEqual(output.body, {
          id: "ORD 1",
          token: "[REDACTED]",
          note: "[REDACTED] suffix"
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },

  {
    name: "HttpToolExecutor blocks private targets unless the tool explicitly allows them",
    run: async () => {
      const executor = new HttpToolExecutor();
      await assert.rejects(
        () =>
          executor.execute({ ...configuredHttpTool, allowPrivateNetwork: false }, { orderId: "1" }),
        /private address/
      );
    }
  },

  {
    name: "HttpToolExecutor fetches and singleflights OAuth2 client credentials tokens",
    run: async () => {
      const executor = new HttpToolExecutor();
      const originalFetch = globalThis.fetch;
      let tokenRequests = 0;
      const businessAuthorizations: string[] = [];
      let tokenRequestBody = "";
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/oauth/token") {
          tokenRequests += 1;
          tokenRequestBody = String(init?.body ?? "");
          await new Promise((resolve) => setTimeout(resolve, 5));
          return new Response(
            JSON.stringify({ access_token: "oauth-token", token_type: "Bearer", expires_in: 3600 }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        businessAuthorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch;

      const config: HttpToolRuntimeConfig = {
        ...configuredHttpTool,
        authType: "oauth2_client_credentials",
        secret: null,
        credentials: { clientId: "mia-client", clientSecret: "client-secret" },
        tokenCacheKey: "oauth-tool:1",
        authConfig: {
          tokenUrl: "http://127.0.0.1:9000/oauth/token",
          clientAuthMethod: "body",
          scope: "orders.read",
          tokenField: "access_token",
          expiresInField: "expires_in",
          tokenTypeField: "token_type",
          defaultTtlSeconds: 300,
          refreshBeforeSeconds: 60
        }
      };

      try {
        await Promise.all([
          executor.execute(config, { orderId: "1" }),
          executor.execute(config, { orderId: "2" })
        ]);
        assert.equal(tokenRequests, 1);
        assert.deepEqual(businessAuthorizations, ["Bearer oauth-token", "Bearer oauth-token"]);
        assert.equal(
          tokenRequestBody,
          "grant_type=client_credentials&client_id=mia-client&client_secret=client-secret&scope=orders.read"
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  },

  {
    name: "HttpToolExecutor refreshes a custom token once after HTTP 401 and redacts credentials",
    run: async () => {
      const executor = new HttpToolExecutor();
      const originalFetch = globalThis.fetch;
      let tokenRequests = 0;
      let businessRequests = 0;
      let tokenRequestHeaders = new Headers();
      let tokenRequestBody = "";
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/custom/token") {
          tokenRequests += 1;
          tokenRequestHeaders = new Headers(init?.headers);
          tokenRequestBody = String(init?.body ?? "");
          return new Response(
            JSON.stringify({ data: { accessToken: `custom-token-${tokenRequests}`, ttl: 3600 } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        businessRequests += 1;
        const authorization = new Headers(init?.headers).get("x-access-token");
        if (businessRequests === 1) return new Response(null, { status: 401 });
        return new Response(JSON.stringify({ authorization, echoedCredential: "custom-secret" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }) as typeof fetch;

      const config: HttpToolRuntimeConfig = {
        ...configuredHttpTool,
        authType: "custom_token",
        secret: null,
        credentials: { appSecret: "custom-secret" },
        tokenCacheKey: "custom-tool:1",
        authConfig: {
          tokenUrl: "http://127.0.0.1:9000/custom/token",
          method: "POST",
          contentType: "application_json",
          parameters: [
            { name: "X-Client", location: "header", value: "mia" },
            { name: "secret", location: "body", credentialKey: "appSecret" }
          ],
          tokenField: "data.accessToken",
          expiresInField: "data.ttl",
          tokenTypeField: "data.type",
          headerName: "X-Access-Token",
          tokenPrefix: "",
          defaultTtlSeconds: 300,
          refreshBeforeSeconds: 60
        }
      };

      try {
        const output = await executor.execute(config, { orderId: "1" });
        assert.equal(tokenRequests, 2);
        assert.equal(businessRequests, 2);
        assert.equal(tokenRequestHeaders.get("x-client"), "mia");
        assert.equal(tokenRequestBody, JSON.stringify({ secret: "custom-secret" }));
        assert.ok(output && typeof output === "object" && !Array.isArray(output));
        assert.deepEqual(output.body, {
          authorization: "[REDACTED]",
          echoedCredential: "[REDACTED]"
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
];
