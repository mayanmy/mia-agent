import {
  AuthProvider,
  Client,
  OAuthClientProvider,
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/client";

export type McpJsonValue =
  null | boolean | number | string | McpJsonValue[] | { [key: string]: McpJsonValue };

export type McpProtocolTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, McpJsonValue>;
  outputSchema?: Record<string, McpJsonValue>;
  annotations?: Record<string, McpJsonValue>;
  execution?: Record<string, McpJsonValue>;
  meta?: Record<string, McpJsonValue>;
};

export type McpProtocolConnectionInfo = {
  protocolVersion?: string;
  protocolEra?: "legacy" | "modern";
  serverInfo?: Record<string, McpJsonValue>;
  capabilities?: Record<string, McpJsonValue>;
};

export type McpProtocolToolResult = {
  content: Array<Record<string, McpJsonValue>>;
  structuredContent?: McpJsonValue;
  isError: boolean;
  meta?: Record<string, McpJsonValue>;
};

export type McpProtocolClientOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxTotalTimeoutMs?: number;
  maxListPages?: number;
  authProvider?: AuthProvider | OAuthClientProvider;
  onToolsChanged?: () => void;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_LIST_PAGES = 64;

/**
 * 隔离官方 MCP SDK 的协议客户端。业务模块只能消费本文件定义的 JSON DTO，
 * 后续 SDK 升级或协议版本变化不会把第三方类型扩散到 ToolsService 和 Runtime。
 */
export class McpProtocolClient {
  private client?: Client;

  constructor(private readonly options: McpProtocolClientOptions) {}

  /** 建立 Streamable HTTP 连接，并自动兼容 2026 与已部署的 2025 协议服务。 */
  async connect(signal?: AbortSignal): Promise<McpProtocolConnectionInfo> {
    if (this.client) {
      return this.getConnectionInfo(this.client);
    }

    const client = new Client(
      { name: "mia", version: "0.1.0" },
      {
        capabilities: {},
        inputRequired: { autoFulfill: false },
        listChanged: this.options.onToolsChanged
          ? {
              tools: {
                autoRefresh: false,
                debounceMs: 300,
                onChanged: (error) => {
                  if (!error) this.options.onToolsChanged?.();
                }
              }
            }
          : undefined,
        listMaxPages: this.options.maxListPages ?? DEFAULT_MAX_LIST_PAGES,
        // SDK 2.x 默认仍使用 2025 握手；Mia 显式启用 auto，先探测 2026，
        // 收到明确的旧协议信号后再回退，避免把协议选择散落到业务代码。
        versionNegotiation: {
          mode: "auto",
          probe: {
            timeoutMs: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
            maxRetries: 0
          }
        }
      }
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.options.endpoint), {
      fetch: this.options.fetch,
      requestInit: this.options.headers ? { headers: { ...this.options.headers } } : undefined,
      // 动态鉴权使用 SDK 标准 AuthProvider 扩展点；Transport 会在 401 后调用刷新并只重试一次。
      authProvider: this.options.authProvider,
      onInsufficientScope: "throw"
    });

    try {
      await this.normalizeAbort(
        client.connect(transport, {
          signal,
          timeout: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          maxTotalTimeout: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
        }),
        signal
      );
      this.client = client;
      return this.getConnectionInfo(client);
    } catch (error) {
      // connect 可能已经打开了 HTTP/SSE 句柄；失败时必须先清理，再保留原始错误给上层分类。
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  /** 使用 SDK 的自动分页能力获取完整工具快照，并强制刷新避免返回过期发现缓存。 */
  async listTools(signal?: AbortSignal): Promise<McpProtocolTool[]> {
    const result = await this.normalizeAbort(
      this.requireClient().listTools(undefined, {
        cacheMode: "refresh",
        signal,
        timeout: this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        maxTotalTimeout: this.options.maxTotalTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
      }),
      signal
    );

    return result.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: this.toJsonRecord(tool.inputSchema, "MCP Tool inputSchema 不是 JSON 对象"),
      outputSchema: tool.outputSchema
        ? this.toJsonRecord(tool.outputSchema, "MCP Tool outputSchema 不是 JSON 对象")
        : undefined,
      annotations: tool.annotations
        ? this.toJsonRecord(tool.annotations, "MCP Tool annotations 不是 JSON 对象")
        : undefined,
      execution: tool.execution
        ? this.toJsonRecord(tool.execution, "MCP Tool execution 不是 JSON 对象")
        : undefined,
      meta: tool._meta ? this.toJsonRecord(tool._meta, "MCP Tool _meta 不是 JSON 对象") : undefined
    }));
  }

  /** 调用远程 Tool；AbortSignal 直接交给 SDK，让 HTTP 请求流在用户取消时立即结束。 */
  async callTool(
    name: string,
    args: Record<string, McpJsonValue>,
    signal?: AbortSignal
  ): Promise<McpProtocolToolResult> {
    const result = await this.normalizeAbort(
      this.requireClient().callTool(
        { name, arguments: args },
        {
          signal,
          timeout: this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
          maxTotalTimeout: this.options.maxTotalTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
        }
      ),
      signal
    );

    return {
      content: result.content.map((item) =>
        this.toJsonRecord(item, "MCP Tool content 不是 JSON 对象")
      ),
      structuredContent:
        result.structuredContent === undefined
          ? undefined
          : this.toJsonValue(result.structuredContent, "MCP structuredContent 不是合法 JSON"),
      isError: result.isError === true,
      meta: result._meta
        ? this.toJsonRecord(result._meta, "MCP Tool result _meta 不是 JSON 对象")
        : undefined
    };
  }

  /** 关闭连接是幂等操作；先清除引用，防止关闭过程中有新调用继续复用旧 Client。 */
  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close();
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("MCP Client 尚未连接");
    }
    return this.client;
  }

  private getConnectionInfo(client: Client): McpProtocolConnectionInfo {
    const serverInfo = client.getServerVersion();
    const capabilities = client.getServerCapabilities();

    return {
      protocolVersion: client.getNegotiatedProtocolVersion(),
      protocolEra: client.getProtocolEra(),
      serverInfo: serverInfo
        ? this.toJsonRecord(serverInfo, "MCP Server 信息不是 JSON 对象")
        : undefined,
      capabilities: capabilities
        ? this.toJsonRecord(capabilities, "MCP Server capabilities 不是 JSON 对象")
        : undefined
    };
  }

  /** SDK 2.x 会把 fetch 的 AbortError 包装成 SdkError；这里恢复 Runtime 依赖的标准取消语义。 */
  private async normalizeAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("MCP 请求已取消", "AbortError");
      }
      throw error;
    }
  }

  /** SDK 已完成协议 Schema 校验，这里再收敛到 Mia 可序列化 DTO，阻止特殊 JS 值越过模块边界。 */
  private toJsonValue(value: unknown, message: string): McpJsonValue {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.toJsonValue(item, message));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.toJsonValue(item, message)])
      );
    }
    throw new Error(message);
  }

  private toJsonRecord(value: unknown, message: string): Record<string, McpJsonValue> {
    const normalized = this.toJsonValue(value, message);
    if (!normalized || Array.isArray(normalized) || typeof normalized !== "object") {
      throw new Error(message);
    }
    return normalized;
  }
}
