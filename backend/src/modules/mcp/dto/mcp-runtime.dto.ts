import { McpClientRuntimeConfig } from "../clients/mcp-protocol-client.factory";

export type McpRuntimeToolDefinition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

/** MCP 执行器需要的不可变快照；不返回给 Controller，也不进入日志。 */
export type McpRuntimeToolConfig = {
  serverId: string;
  toolId: string;
  runtimeId: string;
  remoteName: string;
  inputSchema: Record<string, unknown>;
  schemaHash: string;
  maxResponseBytes: number;
  maxOutputChars: number;
  maxConcurrency: number;
  client: McpClientRuntimeConfig;
};

export class McpRuntimeResolutionError extends Error {
  constructor(
    readonly errorType: string,
    message: string
  ) {
    super(message);
  }
}
