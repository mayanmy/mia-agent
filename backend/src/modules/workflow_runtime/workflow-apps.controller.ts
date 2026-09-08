import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { UserRole, WorkflowRunMode } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired } from "../../core/auth/workspace.decorator";
import { RequestWithId } from "../../core/request-id.middleware";
import { CurrentUserDto } from "../users/dto/user.dto";
import { PublishedWorkflowApp } from "../workflows/dto/workflow-version.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import { WorkflowAppRunDto, WorkflowAppRunResult } from "./dto/workflow-run.dto";
import { WorkflowRuntimeService } from "./workflow-runtime.service";

/** 已发布 Workflow 的成员应用入口，不暴露草稿和编译计划。 */
@Controller("workflow-apps")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRequired()
export class WorkflowAppsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowRuntimeService: WorkflowRuntimeService
  ) {}

  /** 返回当前可直接运行的 Workflow 应用。 */
  @Get()
  listApps(): Promise<PublishedWorkflowApp[]> {
    return this.workflowsService.listPublishedApps();
  }

  /** 返回运行表单定义和明确发布版本。 */
  @Get(":workflowId")
  getApp(@Param("workflowId") workflowId: string): Promise<PublishedWorkflowApp> {
    return this.workflowsService.getPublishedApp(workflowId);
  }

  /** 第一版收集 Runtime 事件后阻塞返回；后续 SSE 入口可直接复用同一迭代器。 */
  @Post(":workflowId/runs")
  async runApp(
    @Param("workflowId") workflowId: string,
    @Body() payload: WorkflowAppRunDto,
    @CurrentUser() currentUser: CurrentUserDto,
    @Req() request: IncomingMessage & RequestWithId
  ): Promise<WorkflowAppRunResult> {
    const app = await this.workflowsService.getPublishedApp(workflowId);
    if (payload.workflowVersionId && payload.workflowVersionId !== app.workflowVersionId) {
      return {
        requestId: request.requestId ?? randomUUID(),
        workflowId,
        workflowVersionId: app.workflowVersionId,
        ok: false,
        error: {
          type: "workflow_version_changed",
          message: "Workflow 已发布新版本，请刷新运行表单",
          retryable: true
        },
        events: []
      };
    }
    const requestId = request.requestId ?? randomUUID();
    const events = [];
    for await (const event of this.workflowRuntimeService.runWorkflow({
      requestId,
      userId: currentUser.id,
      workflowId,
      workflowVersionId: app.workflowVersionId,
      mode: WorkflowRunMode.PUBLISHED,
      inputs: payload.inputs ?? {}
    })) {
      events.push(event);
    }
    const completed = [...events].reverse().find((event) => event.type === "workflow_completed");
    const failed = [...events].reverse().find((event) => event.type === "workflow_failed");
    const output = completed?.type === "workflow_completed" ? completed.data.output : undefined;
    return {
      requestId,
      workflowId,
      workflowVersionId: app.workflowVersionId,
      ok: Boolean(completed),
      ...(output && typeof output === "object" && !Array.isArray(output)
        ? { output: output as Record<string, unknown> }
        : {}),
      ...(failed?.type === "workflow_failed" ? { error: failed.data.error } : {}),
      events
    };
  }
}
