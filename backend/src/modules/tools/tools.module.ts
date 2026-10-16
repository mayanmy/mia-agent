import { Module } from "@nestjs/common";

import { ToolsController } from "./tools.controller";
import { ToolsService } from "./tools.service";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import { HttpToolExecutor } from "./http/http-tool.executor";
import { McpModule } from "../mcp/mcp.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [McpModule, StorageModule],
  controllers: [ToolsController],
  providers: [ToolsService, ConfiguredHttpToolsService, HttpToolExecutor],
  exports: [ToolsService]
})
export class ToolsModule {}
