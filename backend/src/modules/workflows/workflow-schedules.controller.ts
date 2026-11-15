import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired, WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  WorkflowScheduleCreateDto,
  WorkflowScheduleDetail,
  WorkflowScheduleListItem,
  WorkflowScheduleManualRunDto,
  WorkflowScheduleManualRunResult,
  WorkflowSchedulePreview,
  WorkflowSchedulePreviewDto,
  WorkflowScheduleRevisionDto,
  WorkflowScheduleRunCancelResult,
  WorkflowScheduleUpdateDto,
  WorkflowScheduleUpgradeVersionDto
} from "./dto/workflow-schedule.dto";
import { WorkflowSchedulesService } from "./workflow-schedules.service";
import { WorkflowScheduleCancellationService } from "./workflow-schedule-cancellation.service";

/** Schedule API 与 Workflow 草稿 API 分离，但数据和业务生命周期仍归 workflows 模块。 */
@Controller()
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRequired()
export class WorkflowSchedulesController {
  constructor(
    private readonly schedulesService: WorkflowSchedulesService,
    private readonly cancellationService: WorkflowScheduleCancellationService
  ) {}

  @Post("workflows/:workflowId/schedules/preview")
  previewSchedule(
    @Param("workflowId") _workflowId: string,
    @Body() payload: WorkflowSchedulePreviewDto
  ): WorkflowSchedulePreview {
    return this.schedulesService.previewSchedule(payload);
  }

  @Post("workflows/:workflowId/schedules")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  createSchedule(
    @Param("workflowId") workflowId: string,
    @Body() payload: WorkflowScheduleCreateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.createSchedule(workflowId, payload, currentUser.id);
  }

  @Get("workflows/:workflowId/schedules")
  listSchedules(@Param("workflowId") workflowId: string): Promise<WorkflowScheduleListItem[]> {
    return this.schedulesService.listSchedules(workflowId);
  }

  @Get("workflow-schedules/:scheduleId")
  getSchedule(@Param("scheduleId") scheduleId: string): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.getScheduleDetail(scheduleId);
  }

  @Patch("workflow-schedules/:scheduleId")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  updateSchedule(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleUpdateDto
  ): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.updateSchedule(scheduleId, payload);
  }

  @Post("workflow-schedules/:scheduleId/pause")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  pauseSchedule(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleRevisionDto
  ): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.pauseSchedule(scheduleId, payload.revision);
  }

  @Post("workflow-schedules/:scheduleId/resume")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  resumeSchedule(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleRevisionDto
  ): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.resumeSchedule(scheduleId, payload.revision);
  }

  @Post("workflow-schedules/:scheduleId/upgrade-version")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  upgradeScheduleVersion(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleUpgradeVersionDto
  ): Promise<WorkflowScheduleDetail> {
    return this.schedulesService.upgradeScheduleVersion(scheduleId, payload);
  }

  @Delete("workflow-schedules/:scheduleId")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  async archiveSchedule(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleRevisionDto
  ): Promise<null> {
    await this.schedulesService.archiveSchedule(scheduleId, payload.revision);
    return null;
  }

  @Post("workflow-schedule-runs/:runId/cancel")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  cancelScheduleRun(@Param("runId") runId: string): Promise<WorkflowScheduleRunCancelResult> {
    return this.cancellationService.requestCancel(runId);
  }

  @Post("workflow-schedules/:scheduleId/runs")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
  createManualRun(
    @Param("scheduleId") scheduleId: string,
    @Body() payload: WorkflowScheduleManualRunDto
  ): Promise<WorkflowScheduleManualRunResult> {
    return this.schedulesService.createManualRun(scheduleId, payload);
  }
}
