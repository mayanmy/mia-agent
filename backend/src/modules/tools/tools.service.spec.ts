import * as assert from "node:assert/strict";

import { ToolsService } from "./tools.service";

export const tests = [
  {
    name: "ToolsService lists enabled builtin tools",
    run: () => {
      const service = new ToolsService();
      const tools = service.listTools();
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
    name: "ToolsService logs tool execution results when prisma is available",
    run: async () => {
      const queries: Array<{ values?: unknown[] }> = [];
      const service = new ToolsService({
        $executeRaw: async (query: { values?: unknown[] }) => {
          queries.push(query);
          return 1;
        }
      } as never);
      const result = await service.executeTool({
        toolCallId: "call-1",
        toolId: "calculator",
        requestId: "request-1",
        agentId: "agent-1",
        input: {
          operation: "add",
          operands: [1, 2]
        }
      });

      assert.equal(result.ok, true);
      assert.equal(queries.length, 1);
      assert.ok(queries[0].values?.includes("request-1"));
      assert.ok(queries[0].values?.includes("agent-1"));
      assert.ok(queries[0].values?.includes("call-1"));
      assert.ok(queries[0].values?.includes("calculator"));
      assert.ok(queries[0].values?.includes("completed"));
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
  }
];
