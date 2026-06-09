import { Controller, Get } from "@nestjs/common";

import { ToolListItem } from "./dto/tool.dto";
import { ToolsService } from "./tools.service";

@Controller("tools")
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  listTools(): ToolListItem[] {
    return this.toolsService.listTools();
  }
}
