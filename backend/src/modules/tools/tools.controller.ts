import { Controller, Get } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { ToolListItem } from "./dto/tool.dto";
import { ToolsService } from "./tools.service";

@Controller("tools")
@Roles(UserRole.ADMIN, UserRole.USER)
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  listTools(): ToolListItem[] {
    return this.toolsService.listTools();
  }
}
