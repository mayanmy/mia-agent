import { Controller, Get, Query } from "@nestjs/common";

import { PageResult } from "../../core/result";
import { ToolCallLogListItem, ToolCallLogQueryDto } from "./dto/log.dto";
import { LogsService } from "./logs.service";

@Controller("logs")
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get("tool-calls")
  async listToolCallLogs(
    @Query() query: ToolCallLogQueryDto
  ): Promise<PageResult<ToolCallLogListItem>> {
    return this.logsService.listToolCallLogs(query);
  }
}
