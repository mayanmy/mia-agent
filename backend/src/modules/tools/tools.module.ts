import { Module } from "@nestjs/common";

import { ToolsController } from "./tools.controller";
import { ToolsService } from "./tools.service";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import { HttpToolExecutor } from "./http/http-tool.executor";

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, ConfiguredHttpToolsService, HttpToolExecutor],
  exports: [ToolsService]
})
export class ToolsModule {}
