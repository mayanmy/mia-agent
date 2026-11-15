import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  WorkflowScheduleConcurrencyPolicy as PrismaConcurrencyPolicy,
  WorkflowScheduleMisfirePolicy as PrismaMisfirePolicy,
  WorkflowScheduleStatus
} from "@prisma/client";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import { ToolsService } from "../tools/tools.service";
import {
  WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES,
  WORKFLOW_SCHEDULE_MISFIRE_POLICIES,
  WorkflowScheduleConcurrencyPolicy,
  WorkflowScheduleCreateDto,
  WorkflowScheduleDetail,
  WorkflowScheduleListItem,
  WorkflowScheduleMisfirePolicy,
  WorkflowSchedulePreview,
  WorkflowSchedulePreviewDto,
  WorkflowScheduleUpdateDto,
  WorkflowScheduleUpgradeVersionDto
} from "./dto/workflow-schedule.dto";
import {
  MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS,
  MAX_WORKFLOW_SCHEDULE_CRON_LENGTH,
  WorkflowSchedulePlanner
} from "./workflow-schedule-planner";

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2_000;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_TIMEOUT_SECONDS = 1_800;

type ScheduleRecord = Prisma.WorkflowScheduleGetPayload<{
  include: { workflowVersion: { select: { version: true } } };
}>;

type VersionRecord = {
  id: string;
  workflowId: string;
  version: number;
  graph: unknown;
};

/**
 * Schedule 是 workflows 模块内的独立生命周期，但只固定到不可变 WorkflowVersion。
 * P1 不创建 Run 或队列 Job，因此 ACTIVE 仅代表业务意图，执行开关保持关闭。
 */
@Injectable()
export class WorkflowSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: WorkflowSchedulePlanner,
    private readonly toolsService: ToolsService
  ) {}

  previewSchedule(payload: WorkflowSchedulePreviewDto): WorkflowSchedulePreview {
    const cronExpression = this.cronExpression(payload.cronExpression);
    const timezone = this.timezone(payload.timezone);
    const from = payload.from === undefined ? new Date() : new Date(payload.from);
    if (Number.isNaN(from.getTime())) {
      throw new AppError(ErrorCodes.common.badRequest, "from 必须是有效的 ISO 时间");
    }
    return {
      cronExpression,
      timezone,
      nextOccurrences: this.planner.preview(cronExpression, timezone, from, 5)
    };
  }

  async createSchedule(
    workflowId: string,
    payload: WorkflowScheduleCreateDto,
    actorUserId: string
  ): Promise<WorkflowScheduleDetail> {
    const normalizedWorkflowId = this.id(workflowId, "workflowId");
    const version = await this.requireVersion(
      normalizedWorkflowId,
      this.id(payload.workflowVersionId, "workflowVersionId")
    );
    const inputs = this.inputs(payload.inputs);
    await this.validateVersionForSchedule(version, inputs);
    const cronExpression = this.cronExpression(payload.cronExpression);
    const timezone = this.timezone(payload.timezone);
    this.planner.validate(cronExpression, timezone);
    const maxCatchUpRuns = this.catchUpRuns(payload.maxCatchUpRuns ?? 1);
    const timeoutSeconds = payload.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.planner.validateTimeoutSeconds(timeoutSeconds);

    const schedule = await this.prisma.workflowSchedule.create({
      data: {
        workspaceId: requireWorkspaceId(),
        workflowId: normalizedWorkflowId,
        workflowVersionId: version.id,
        name: this.name(payload.name),
        description: this.description(payload.description),
        // P1 即使收到客户端的启用意图也只创建 PAUSED，避免配置阶段意外执行。
        status: WorkflowScheduleStatus.PAUSED,
        cronExpression,
        timezone,
        inputs: inputs as Prisma.InputJsonValue,
        misfirePolicy: this.misfirePolicy(payload.misfirePolicy),
        concurrencyPolicy: this.concurrencyPolicy(payload.concurrencyPolicy),
        maxCatchUpRuns,
        timeoutSeconds,
        nextRunAt: null,
        createdByUserId: this.id(actorUserId, "actorUserId")
      },
      include: { workflowVersion: { select: { version: true } } }
    });
    return this.toDetail(schedule);
  }

  async listSchedules(workflowId: string): Promise<WorkflowScheduleListItem[]> {
    const id = this.id(workflowId, "workflowId");
    await this.requireWorkflow(id);
    const schedules = await this.prisma.workflowSchedule.findMany({
      where: {
        workspaceId: requireWorkspaceId(),
        workflowId: id,
        status: { not: WorkflowScheduleStatus.ARCHIVED }
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { workflowVersion: { select: { version: true } } }
    });
    return schedules.map((schedule) => this.toListItem(schedule));
  }

  async getScheduleDetail(scheduleId: string): Promise<WorkflowScheduleDetail> {
    return this.toDetail(await this.requireSchedule(scheduleId, true));
  }

  async updateSchedule(
    scheduleId: string,
    payload: WorkflowScheduleUpdateDto
  ): Promise<WorkflowScheduleDetail> {
    const current = await this.requireSchedule(scheduleId);
    const revision = this.revision(payload.revision);
    const version = payload.workflowVersionId
      ? await this.requireVersion(current.workflowId, payload.workflowVersionId)
      : await this.requireVersion(current.workflowId, current.workflowVersionId);
    const inputs =
      payload.inputs === undefined ? this.jsonObject(current.inputs) : this.inputs(payload.inputs);
    if (payload.inputs !== undefined || payload.workflowVersionId !== undefined) {
      await this.validateVersionForSchedule(version, inputs);
    }

    const cronExpression =
      payload.cronExpression === undefined
        ? current.cronExpression
        : this.cronExpression(payload.cronExpression);
    const timezone =
      payload.timezone === undefined ? current.timezone : this.timezone(payload.timezone);
    this.planner.validate(cronExpression, timezone);
    const maxCatchUpRuns =
      payload.maxCatchUpRuns === undefined
        ? current.maxCatchUpRuns
        : this.catchUpRuns(payload.maxCatchUpRuns);
    const timeoutSeconds = payload.timeoutSeconds ?? current.timeoutSeconds;
    this.planner.validateTimeoutSeconds(timeoutSeconds);

    await this.updateWithRevision(current.id, revision, {
      ...(payload.name === undefined ? {} : { name: this.name(payload.name) }),
      ...(payload.description === undefined
        ? {}
        : { description: this.description(payload.description) }),
      workflowVersionId: version.id,
      cronExpression,
      timezone,
      inputs: inputs as Prisma.InputJsonValue,
      misfirePolicy: this.misfirePolicy(payload.misfirePolicy ?? current.misfirePolicy),
      concurrencyPolicy: this.concurrencyPolicy(
        payload.concurrencyPolicy ?? current.concurrencyPolicy
      ),
      maxCatchUpRuns,
      timeoutSeconds,
      nextRunAt:
        current.status === WorkflowScheduleStatus.ACTIVE
          ? this.planner.next(cronExpression, timezone, new Date())
          : null
    });
    return this.getScheduleDetail(current.id);
  }

  async pauseSchedule(scheduleId: string, revisionValue: unknown): Promise<WorkflowScheduleDetail> {
    const current = await this.requireSchedule(scheduleId);
    await this.updateWithRevision(current.id, this.revision(revisionValue), {
      status: WorkflowScheduleStatus.PAUSED,
      nextRunAt: null
    });
    return this.getScheduleDetail(current.id);
  }

  async resumeSchedule(
    scheduleId: string,
    revisionValue: unknown
  ): Promise<WorkflowScheduleDetail> {
    const current = await this.requireSchedule(scheduleId);
    const version = await this.requireVersion(current.workflowId, current.workflowVersionId);
    await this.validateVersionForSchedule(version, this.jsonObject(current.inputs));
    await this.updateWithRevision(current.id, this.revision(revisionValue), {
      status: WorkflowScheduleStatus.ACTIVE,
      nextRunAt: this.planner.next(current.cronExpression, current.timezone, new Date())
    });
    return this.getScheduleDetail(current.id);
  }

  async archiveSchedule(scheduleId: string, revisionValue: unknown): Promise<void> {
    const current = await this.requireSchedule(scheduleId);
    await this.updateWithRevision(current.id, this.revision(revisionValue), {
      status: WorkflowScheduleStatus.ARCHIVED,
      archivedAt: new Date(),
      nextRunAt: null
    });
  }

  async upgradeScheduleVersion(
    scheduleId: string,
    payload: WorkflowScheduleUpgradeVersionDto
  ): Promise<WorkflowScheduleDetail> {
    const current = await this.requireSchedule(scheduleId);
    const version = await this.requireVersion(
      current.workflowId,
      this.id(payload.workflowVersionId, "workflowVersionId")
    );
    const inputs = this.jsonObject(current.inputs);
    await this.validateVersionForSchedule(version, inputs);
    await this.updateWithRevision(current.id, this.revision(payload.revision), {
      workflowVersionId: version.id
    });
    return this.getScheduleDetail(current.id);
  }

  private async updateWithRevision(
    id: string,
    revision: number,
    data: Prisma.WorkflowScheduleUncheckedUpdateManyInput
  ): Promise<void> {
    const updated = await this.prisma.workflowSchedule.updateMany({
      where: {
        id,
        workspaceId: requireWorkspaceId(),
        revision,
        status: { not: WorkflowScheduleStatus.ARCHIVED }
      },
      data: { ...data, revision: { increment: 1 } }
    });
    if (updated.count !== 1) {
      const current = await this.prisma.workflowSchedule.findFirst({
        where: { id, workspaceId: requireWorkspaceId() },
        select: { status: true }
      });
      if (!current) throw this.notFound();
      if (current.status === WorkflowScheduleStatus.ARCHIVED) throw this.archived();
      throw new AppError(
        ErrorCodes.workflow.scheduleRevisionConflict,
        "定时任务已被其他操作更新，请刷新后重试",
        HttpStatus.CONFLICT
      );
    }
  }

  private async requireWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.prisma.workflow.findFirst({
      where: {
        id: workflowId,
        workspaceId: requireWorkspaceId(),
        deletedAt: null,
        status: "PUBLISHED"
      },
      select: { id: true }
    });
    if (!workflow) {
      throw new AppError(
        ErrorCodes.workflow.notPublished,
        "Workflow 尚未发布或已归档",
        HttpStatus.CONFLICT
      );
    }
  }

  private async requireVersion(workflowId: string, versionId: string): Promise<VersionRecord> {
    await this.requireWorkflow(workflowId);
    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        id: this.id(versionId, "workflowVersionId"),
        workflowId,
        workspaceId: requireWorkspaceId()
      },
      select: { id: true, workflowId: true, version: true, graph: true }
    });
    if (!version) {
      throw new AppError(
        ErrorCodes.workflow.scheduleVersionInvalid,
        "Workflow Version 不属于当前 Workflow",
        HttpStatus.BAD_REQUEST
      );
    }
    return version;
  }

  private async requireSchedule(idValue: string, includeArchived = false): Promise<ScheduleRecord> {
    const schedule = await this.prisma.workflowSchedule.findFirst({
      where: {
        id: this.id(idValue, "scheduleId"),
        workspaceId: requireWorkspaceId(),
        ...(includeArchived ? {} : { status: { not: WorkflowScheduleStatus.ARCHIVED } })
      },
      include: { workflowVersion: { select: { version: true } } }
    });
    if (!schedule) throw this.notFound();
    return schedule;
  }

  private async validateVersionForSchedule(
    version: VersionRecord,
    inputs: Record<string, unknown>
  ): Promise<void> {
    this.planner.validateInputSize(inputs);
    const graph = this.jsonObject(version.graph);
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const start = nodes.find((value) => this.isRecord(value) && value.type === "start") as
      Record<string, unknown> | undefined;
    const config = start && this.isRecord(start.config) ? start.config : null;
    const definitions = config && Array.isArray(config.inputs) ? config.inputs : [];
    const allowed = new Set<string>();

    for (const raw of definitions) {
      if (!this.isRecord(raw) || typeof raw.name !== "string" || typeof raw.type !== "string") {
        throw this.invalidInput("发布版本的 Start 输入定义无效");
      }
      allowed.add(raw.name);
      const value = inputs[raw.name];
      if (
        (value === undefined || value === null) &&
        raw.required === true &&
        raw.defaultValue === undefined
      ) {
        throw this.invalidInput(`缺少必填输入: ${raw.name}`);
      }
      if (value !== undefined && value !== null && !this.matchesType(value, raw.type)) {
        throw this.invalidInput(`输入 ${raw.name} 类型必须为 ${raw.type}`);
      }
    }
    const unknown = Object.keys(inputs).find((key) => !allowed.has(key));
    if (unknown) throw this.invalidInput(`存在未声明的输入: ${unknown}`);

    const toolIds = nodes.flatMap((value) => {
      if (!this.isRecord(value) || value.type !== "tool" || !this.isRecord(value.config)) return [];
      return typeof value.config.toolId === "string" ? [value.config.toolId] : [];
    });
    const interactive = await this.toolsService.getInteractiveApprovalToolIds(toolIds);
    if (interactive.length > 0) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInteractiveToolUnsupported,
        `定时任务不能使用需要人工审批的工具: ${interactive.join(", ")}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private toListItem(schedule: ScheduleRecord): WorkflowScheduleListItem {
    return {
      id: schedule.id,
      workflowId: schedule.workflowId,
      workflowVersionId: schedule.workflowVersionId,
      workflowVersion: schedule.workflowVersion.version,
      name: schedule.name,
      description: schedule.description,
      status: schedule.status,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      misfirePolicy: schedule.misfirePolicy,
      concurrencyPolicy: schedule.concurrencyPolicy,
      maxCatchUpRuns: schedule.maxCatchUpRuns,
      timeoutSeconds: schedule.timeoutSeconds,
      nextRunAt: schedule.nextRunAt,
      lastScheduledAt: schedule.lastScheduledAt,
      lastStartedAt: schedule.lastStartedAt,
      lastFinishedAt: schedule.lastFinishedAt,
      createdByUserId: schedule.createdByUserId,
      revision: schedule.revision,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt
    };
  }

  private toDetail(schedule: ScheduleRecord): WorkflowScheduleDetail {
    return { ...this.toListItem(schedule), inputs: this.jsonObject(schedule.inputs) };
  }

  private cronExpression(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.workflow.scheduleInvalidCron, "Cron 表达式不能为空");
    }
    const result = value.trim().replace(/\s+/gu, " ");
    if (result.length > MAX_WORKFLOW_SCHEDULE_CRON_LENGTH) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        `Cron 表达式不能超过 ${MAX_WORKFLOW_SCHEDULE_CRON_LENGTH} 个字符`
      );
    }
    return result;
  }

  private timezone(value: unknown): string {
    if (value === undefined) return DEFAULT_TIMEZONE;
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.workflow.scheduleInvalidTimezone, "timezone 不能为空");
    }
    return value.trim();
  }

  private inputs(value: unknown): Record<string, unknown> {
    if (value === undefined) return {};
    if (!this.isRecord(value)) throw this.invalidInput("inputs 必须是 JSON 对象");
    return value;
  }

  private name(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, "name is required");
    }
    const result = value.trim();
    if (result.length > MAX_NAME_LENGTH) {
      throw new AppError(ErrorCodes.common.badRequest, `name 不能超过 ${MAX_NAME_LENGTH} 个字符`);
    }
    return result;
  }

  private description(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "description 必须是字符串");
    }
    const result = value.trim();
    if (result.length > MAX_DESCRIPTION_LENGTH) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `description 不能超过 ${MAX_DESCRIPTION_LENGTH} 个字符`
      );
    }
    return result;
  }

  private revision(value: unknown): number {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new AppError(ErrorCodes.common.badRequest, "revision 必须是正整数");
    }
    return Number(value);
  }

  private catchUpRuns(value: unknown): number {
    if (
      !Number.isInteger(value) ||
      Number(value) < 1 ||
      Number(value) > MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS
    ) {
      throw new AppError(
        ErrorCodes.workflow.scheduleCatchUpLimitInvalid,
        `maxCatchUpRuns 必须是 1 到 ${MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS} 之间的整数`
      );
    }
    return Number(value);
  }

  private misfirePolicy(value: unknown): PrismaMisfirePolicy {
    const normalized = value ?? "RUN_ONCE";
    if (!WORKFLOW_SCHEDULE_MISFIRE_POLICIES.includes(normalized as WorkflowScheduleMisfirePolicy)) {
      throw new AppError(ErrorCodes.workflow.scheduleInvalidPolicy, "misfirePolicy 无效");
    }
    return normalized as PrismaMisfirePolicy;
  }

  private concurrencyPolicy(value: unknown): PrismaConcurrencyPolicy {
    const normalized = value ?? "QUEUE";
    if (
      !WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES.includes(
        normalized as WorkflowScheduleConcurrencyPolicy
      )
    ) {
      throw new AppError(ErrorCodes.workflow.scheduleInvalidPolicy, "concurrencyPolicy 无效");
    }
    return normalized as PrismaConcurrencyPolicy;
  }

  private id(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} is required`);
    }
    return value.trim();
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    if (!this.isRecord(value)) throw this.invalidInput("JSON 配置必须是对象");
    return value;
  }

  private matchesType(value: unknown, type: string): boolean {
    if (type === "array") return Array.isArray(value);
    if (type === "object") return this.isRecord(value);
    return typeof value === type;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private invalidInput(message: string): AppError {
    return new AppError(ErrorCodes.workflow.scheduleInputInvalid, message, HttpStatus.BAD_REQUEST);
  }

  private notFound(): AppError {
    return new AppError(
      ErrorCodes.workflow.scheduleNotFound,
      "Workflow 定时任务不存在",
      HttpStatus.NOT_FOUND
    );
  }

  private archived(): AppError {
    return new AppError(
      ErrorCodes.workflow.scheduleArchived,
      "已归档定时任务不能再次修改或启用",
      HttpStatus.CONFLICT
    );
  }
}
