import { Controller, Get, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { PageResult } from "../../core/result";
import { RagTraceQueryDto, ToolCallLogListItem, ToolCallLogQueryDto } from "./dto/log.dto";
import { LogsService } from "./logs.service";

@Controller("logs")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get("tool-calls")
  async listToolCallLogs(
    @Query() query: ToolCallLogQueryDto
  ): Promise<PageResult<ToolCallLogListItem>> {
    return this.logsService.listToolCallLogs(query);
  }

  /** RAG Trace 可能包含用户问题和受控片段，仅空间管理员可查询。 */
  @Get("rag-traces")
  async listRagTraces(@Query() query: RagTraceQueryDto) {
    return this.logsService.listRagTraces(query);
  }
}
