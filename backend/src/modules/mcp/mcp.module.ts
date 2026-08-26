import { Module } from "@nestjs/common";

import { McpProtocolClientFactory } from "./clients/mcp-protocol-client.factory";
import { McpOAuthManager } from "./clients/mcp-oauth.manager";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { McpToolExecutor } from "./mcp-tool.executor";
import { McpApprovalService } from "./mcp-approval.service";
import { McpApprovalsController } from "./mcp-approvals.controller";

@Module({
  controllers: [McpController, McpApprovalsController],
  providers: [
    McpService,
    McpApprovalService,
    McpOAuthManager,
    McpProtocolClientFactory,
    McpToolExecutor
  ],
  // M2 由 ToolsModule 只依赖此公开 Service 获取可执行快照，不直接访问 MCP 数据表。
  exports: [McpService, McpApprovalService, McpToolExecutor]
})
export class McpModule {}
