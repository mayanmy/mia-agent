import { Injectable } from "@nestjs/common";

import { McpProtocolClient } from "./mcp-protocol.client";
import { createMcpSafeFetch } from "../mcp-network-policy";

export type McpClientRuntimeConfig = {
  endpoint: string;
  authType: "none" | "bearer" | "api_key_header" | "client_credentials";
  authConfig: Record<string, unknown>;
  secret?: string;
  allowPrivateNetwork: boolean;
  connectTimeoutMs: number;
  toolTimeoutMs: number;
};

@Injectable()
export class McpProtocolClientFactory {
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
    } else if (config.authType === "client_credentials") {
      // OAuth client_credentials 在 M4 接入 Token cache、single-flight 和 401 强制刷新；
      // M1 先允许保存配置，但禁止误以为静态密钥可以直接作为访问令牌发送。
      throw new Error("MCP client_credentials will be enabled in authentication phase M4");
    }

    return new McpProtocolClient({
      endpoint: config.endpoint,
      headers,
      fetch: createMcpSafeFetch(config.allowPrivateNetwork),
      connectTimeoutMs: config.connectTimeoutMs,
      requestTimeoutMs: config.toolTimeoutMs
    });
  }
}
