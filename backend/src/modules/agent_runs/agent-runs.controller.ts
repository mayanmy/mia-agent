import { Controller, Get, Param, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { PageResult } from "../../core/result";
import { AgentRunsService } from "./agent-runs.service";
import { AgentRunDetail, AgentRunListItem, AgentRunQueryDto } from "./dto/agent-run-query.dto";

@Controller("agent-runs")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
export class AgentRunsController {
  constructor(private readonly agentRunsService: AgentRunsService) {}

  /** 返回管理员 Run 列表；权限由类级 RolesGuard 统一保证。 */
  @Get()
  listRuns(@Query() query: AgentRunQueryDto): Promise<PageResult<AgentRunListItem>> {
    return this.agentRunsService.listRuns(query);
  }

  /** 返回单次 Run 及其有序 Step Timeline，不暴露未持久化的模型密钥或附件。 */
  @Get(":runId")
  getRunDetail(@Param("runId") runId: string): Promise<AgentRunDetail> {
    return this.agentRunsService.getRunDetail(runId);
  }
}
