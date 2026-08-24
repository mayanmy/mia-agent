import { Module } from "@nestjs/common";

import { McpProtocolClientFactory } from "./clients/mcp-protocol-client.factory";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

@Module({
  controllers: [McpController],
  providers: [McpService, McpProtocolClientFactory],
  // M2 由 ToolsModule 只依赖此公开 Service 获取可执行快照，不直接访问 MCP 数据表。
  exports: [McpService]
})
export class McpModule {}
