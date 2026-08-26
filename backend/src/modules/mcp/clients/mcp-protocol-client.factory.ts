import { Injectable } from "@nestjs/common";

import { McpProtocolClient } from "./mcp-protocol.client";
import { createMcpSafeFetch } from "../mcp-network-policy";
import {
  McpClientCredentialsConfig,
  McpClientCredentialsProvider
} from "./mcp-client-credentials.provider";

export type McpClientRuntimeConfig = {
  serverId: string;
  endpoint: string;
  authType: "none" | "bearer" | "api_key_header" | "client_credentials";
  authConfig: Record<string, unknown>;
  secret?: string;
  credentials?: Record<string, string>;
  authCacheKey?: string;
  allowPrivateNetwork: boolean;
  connectTimeoutMs: number;
  toolTimeoutMs: number;
};

@Injectable()
export class McpProtocolClientFactory {
  private readonly dynamicProviders = new Map<string, McpClientCredentialsProvider>();
  private toolsChangedHandler?: (serverId: string) => void;

  /** Service 注册通知入口，Runtime DTO 仍保持纯 JSON，便于未来远程化。 */
  registerToolsChangedHandler(handler: (serverId: string) => void): void {
    this.toolsChangedHandler = handler;
  }

  /** 凭据只在内存中展开并写入 SDK 请求头，绝不进入发现快照和返回 DTO。 */
  create(config: McpClientRuntimeConfig): McpProtocolClient {
    const headers: Record<string, string> = {};

    if (config.authType === "bearer") {
      if (!config.secret) throw new Error("MCP Bearer token is not configured");
      headers.authorization = `Bearer ${config.secret}`;
    } else if (config.authType === "api_key_header") {
      if (!config.secret) throw new Error("MCP API key is not configured");
      const headerName = String(config.authConfig.headerName ?? "").trim();
      if (!headerName || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) {
        throw new Error("MCP API key header name is invalid");
      }
      headers[headerName] = config.secret;
    }

    const authProvider =
      config.authType === "client_credentials"
        ? this.getClientCredentialsProvider(config)
        : undefined;

    return new McpProtocolClient({
      endpoint: config.endpoint,
      headers,
      fetch: createMcpSafeFetch(config.allowPrivateNetwork),
      connectTimeoutMs: config.connectTimeoutMs,
      requestTimeoutMs: config.toolTimeoutMs,
      authProvider,
      onToolsChanged: this.toolsChangedHandler
        ? () => this.toolsChangedHandler?.(config.serverId)
        : undefined
    });
  }

  /** 配置版本作为缓存键；管理员更新凭据后会生成新 Provider，旧 Token 不再被使用。 */
  private getClientCredentialsProvider(
    config: McpClientRuntimeConfig
  ): McpClientCredentialsProvider {
    const cacheKey = config.authCacheKey;
    if (!cacheKey) throw new Error("MCP dynamic auth cache key is missing");
    const existing = this.dynamicProviders.get(cacheKey);
    if (existing) return existing;

    const credentials = config.credentials ?? {};
    const authConfig = config.authConfig;
    const providerConfig: McpClientCredentialsConfig = {
      cacheKey,
      serverId: cacheKey.split(":", 1)[0],
      tokenUrl: String(authConfig.tokenUrl ?? ""),
      clientAuthMethod: authConfig.clientAuthMethod === "basic" ? "basic" : "body",
      clientId: credentials.clientId ?? "",
      clientSecret: credentials.clientSecret ?? "",
      scope: typeof authConfig.scope === "string" ? authConfig.scope : undefined,
      audience: typeof authConfig.audience === "string" ? authConfig.audience : undefined,
      tokenField: String(authConfig.tokenField ?? "access_token"),
      expiresInField: String(authConfig.expiresInField ?? "expires_in"),
      tokenTypeField: String(authConfig.tokenTypeField ?? "token_type"),
      defaultTtlSeconds: Number(authConfig.defaultTtlSeconds ?? 300),
      refreshBeforeSeconds: Number(authConfig.refreshBeforeSeconds ?? 60),
      timeoutMs: config.connectTimeoutMs,
      allowPrivateNetwork: config.allowPrivateNetwork
    };
    if (!providerConfig.tokenUrl || !providerConfig.clientId || !providerConfig.clientSecret) {
      throw new Error("MCP client credentials configuration is incomplete");
    }
    const provider = new McpClientCredentialsProvider(providerConfig);
    this.dynamicProviders.set(cacheKey, provider);
    this.pruneSupersededProviders(cacheKey);
    return provider;
  }

  private pruneSupersededProviders(activeKey: string): void {
    const prefix = `${activeKey.split(":", 1)[0]}:`;
    for (const key of this.dynamicProviders.keys()) {
      if (key.startsWith(prefix) && key !== activeKey) this.dynamicProviders.delete(key);
    }
  }
}
