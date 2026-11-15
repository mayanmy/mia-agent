import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  PrismaClient,
  WorkflowScheduleRun,
  WorkflowScheduleJobDispatchStatus,
  WorkflowScheduleConcurrencyPolicy as PrismaConcurrencyPolicy,
  WorkflowScheduleMisfirePolicy as PrismaMisfirePolicy,
  WorkflowScheduleRunStatus,
  WorkflowScheduleRunTrigger,
  WorkflowScheduleStatus
} from "@prisma/client";

import { requireWorkspaceId } from "../../core/auth/workspace-context";
import { AppError, ErrorCodes } from "../../core/errors";
import { normalizePageQuery, createPageResult } from "../../core/pagination";
import { PageResult } from "../../core/result";
import { PrismaService } from "../prisma/prisma.service";
import { ToolsService } from "../tools/tools.service";
import {
  WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES,
  WORKFLOW_SCHEDULE_MISFIRE_POLICIES,
  DueScheduleClaim,
  MaterializedScheduleRuns,
  WorkflowScheduleConcurrencyPolicy,
  WorkflowScheduleCreateDto,
  WorkflowScheduleDetail,
  WorkflowScheduleListItem,
  WorkflowScheduleManualRunDto,
  WorkflowScheduleManualRunResult,
  WorkflowScheduleStaleRun,
  WorkflowScheduleLinkedRun,
  WorkflowScheduleDispatchedJob,
  WorkflowScheduleMisfirePolicy,
  WorkflowSchedulePreview,
  WorkflowSchedulePreviewDto,
  WorkflowScheduleUpdateDto,
  WorkflowScheduleUpgradeVersionDto,
  WorkflowScheduleJobDispatchDto,
  WorkflowScheduleRunExecution,
  WorkflowScheduleRunCancelResult,
  WorkflowScheduleRunDetail,
  WorkflowScheduleRunListItem,
  WorkflowScheduleRunTerminalStatus,
  WorkflowScheduleRunQueryDto,
  WorkflowScheduleHealthSummary,
  WorkflowScheduleCleanupResult
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
const MAX_PARALLEL_SCHEDULE_RUNS = 3;
const CONCURRENCY_RETRY_DELAY_MS = 5_000;

type ScheduleRecord = Prisma.WorkflowScheduleGetPayload<{
  include: { workflowVersion: { select: { version: true } } };
}>;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type VersionRecord = {
  id: string;
  workflowId: string;
  version: number;
  graph: unknown;
};

type LockedSchedule = {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  status: WorkflowScheduleStatus;
  cronExpression: string;
  timezone: string;
  inputs: unknown;
  misfirePolicy: PrismaMisfirePolicy;
  maxCatchUpRuns: number;
  nextRunAt: Date | null;
  revision: number;
};

/**
 * Schedule 是 workflows 模块内的独立生命周期，但只固定到不可变 WorkflowVersion。
 * 调度执行仍只通过本服务暴露的 DTO 和状态用例访问，不向 Worker 泄漏 Prisma Model。
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
    const failures = await Promise.all(
      schedules.map((schedule) => this.getConsecutiveFailures(schedule.id))
    );
    return schedules.map((schedule, index) => this.toListItem(schedule, failures[index] ?? 0));
  }

  async getScheduleDetail(scheduleId: string): Promise<WorkflowScheduleDetail> {
    return this.toDetail(await this.requireSchedule(scheduleId, true));
  }

  async listScheduleRuns(
    scheduleId: string,
    query: WorkflowScheduleRunQueryDto
  ): Promise<PageResult<WorkflowScheduleRunListItem>> {
    const schedule = await this.requireSchedule(scheduleId, true);
    const page = normalizePageQuery(query);
    const status = this.runStatus(query.status);
    const where: Prisma.WorkflowScheduleRunWhereInput = {
      scheduleId: schedule.id,
      workspaceId: requireWorkspaceId(),
      ...(status ? { status } : {})
    };
    const [runs, total] = await Promise.all([
      this.prisma.workflowScheduleRun.findMany({
        where,
        orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take
      }),
      this.prisma.workflowScheduleRun.count({ where })
    ]);
    const versions = await this.prisma.workflowVersion.findMany({
      where: { id: { in: [...new Set(runs.map((run) => run.workflowVersionId))] } },
      select: { id: true, version: true }
    });
    const versionById = new Map(versions.map((version) => [version.id, version.version]));
    return createPageResult(
      runs.map((run) => this.toRunListItem(run, versionById.get(run.workflowVersionId) ?? 0)),
      total,
      page.page,
      page.pageSize
    );
  }

  async getScheduleRunDetail(runIdValue: string): Promise<WorkflowScheduleRunDetail> {
    const run = await this.prisma.workflowScheduleRun.findFirst({
      where: { id: this.id(runIdValue, "runId"), workspaceId: requireWorkspaceId() }
    });
    if (!run) {
      throw new AppError(
        ErrorCodes.workflow.scheduleRunNotFound,
        "Workflow Schedule Run 不存在",
        HttpStatus.NOT_FOUND
      );
    }
    const version = await this.prisma.workflowVersion.findUnique({
      where: { id: run.workflowVersionId },
      select: { version: true }
    });
    return {
      ...this.toRunListItem(run, version?.version ?? 0),
      requestId: run.requestId,
      scheduleRevision: run.scheduleRevision,
      workerId: run.workerId,
      heartbeatAt: run.heartbeatAt,
      cancelRequestedAt: run.cancelRequestedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    };
  }

  /** 聚合全局运行信号供基础健康检查使用；不返回任何 Workspace 级业务数据。 */
  async getOperationalHealthSummary(
    now = new Date(),
    staleMs = 60_000,
    overdueMs = 60_000
  ): Promise<WorkflowScheduleHealthSummary> {
    this.validDate(now, "now");
    const staleBefore = new Date(now.getTime() - staleMs);
    const overdueBefore = new Date(now.getTime() - overdueMs);
    const [
      activeSchedules,
      overdueSchedules,
      queuedRuns,
      runningRuns,
      staleRunningRuns,
      pendingDispatches,
      oldestQueued
    ] = await Promise.all([
      this.prisma.workflowSchedule.count({ where: { status: WorkflowScheduleStatus.ACTIVE } }),
      this.prisma.workflowSchedule.count({
        where: { status: WorkflowScheduleStatus.ACTIVE, nextRunAt: { lt: overdueBefore } }
      }),
      this.prisma.workflowScheduleRun.count({
        where: { status: WorkflowScheduleRunStatus.QUEUED }
      }),
      this.prisma.workflowScheduleRun.count({
        where: { status: WorkflowScheduleRunStatus.RUNNING }
      }),
      this.prisma.workflowScheduleRun.count({
        where: {
          status: WorkflowScheduleRunStatus.RUNNING,
          OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleBefore } }]
        }
      }),
      this.prisma.workflowScheduleJob.count({
        where: { dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING }
      }),
      this.prisma.workflowScheduleRun.findFirst({
        where: { status: WorkflowScheduleRunStatus.QUEUED },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true }
      })
    ]);
    return {
      activeSchedules,
      overdueSchedules,
      queuedRuns,
      runningRuns,
      staleRunningRuns,
      pendingDispatches,
      oldestQueuedSeconds: oldestQueued
        ? Math.max(0, Math.floor((now.getTime() - oldestQueued.createdAt.getTime()) / 1_000))
        : null
    };
  }

  /** 仅清理终态调度记录；RUNNING/QUEUED 永不因保留策略被删除。 */
  async cleanupExpiredRuns(
    completedRetentionDays: number,
    failedRetentionDays: number,
    now = new Date()
  ): Promise<WorkflowScheduleCleanupResult> {
    const completedDays = this.retentionDays(completedRetentionDays, "completedRetentionDays");
    const failedDays = this.retentionDays(failedRetentionDays, "failedRetentionDays");
    this.validDate(now, "now");
    const completedBefore = new Date(now.getTime() - completedDays * 86_400_000);
    const failedBefore = new Date(now.getTime() - failedDays * 86_400_000);
    const [completed, failed] = await this.prisma.$transaction([
      this.prisma.workflowScheduleRun.deleteMany({
        where: {
          status: {
            in: [
              WorkflowScheduleRunStatus.COMPLETED,
              WorkflowScheduleRunStatus.CANCELED,
              WorkflowScheduleRunStatus.SKIPPED
            ]
          },
          finishedAt: { lt: completedBefore }
        }
      }),
      this.prisma.workflowScheduleRun.deleteMany({
        where: {
          status: { in: [WorkflowScheduleRunStatus.FAILED, WorkflowScheduleRunStatus.TIMED_OUT] },
          finishedAt: { lt: failedBefore }
        }
      })
    ]);
    return { completedDeleted: completed.count, failedDeleted: failed.count };
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

  /** 手动补跑复用相同发生时间的业务幂等键；重复请求返回已有 Run，不创建派生重试。 */
  async createManualRun(
    scheduleIdValue: string,
    payload: WorkflowScheduleManualRunDto = {}
  ): Promise<WorkflowScheduleManualRunResult> {
    const schedule = await this.requireSchedule(scheduleIdValue);
    const version = await this.requireVersion(schedule.workflowId, schedule.workflowVersionId);
    const inputs = this.jsonObject(schedule.inputs);
    await this.validateVersionForSchedule(version, inputs);
    const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : new Date();
    this.validDate(scheduledFor, "scheduledFor");

    return this.prisma.$transaction(async (transaction) => {
      const runId = randomUUID();
      const inserted = await transaction.workflowScheduleRun.createMany({
        data: [
          {
            id: runId,
            workspaceId: schedule.workspaceId,
            scheduleId: schedule.id,
            workflowId: schedule.workflowId,
            workflowVersionId: schedule.workflowVersionId,
            scheduledFor,
            trigger: WorkflowScheduleRunTrigger.MANUAL_BACKFILL,
            status: WorkflowScheduleRunStatus.QUEUED,
            inputSnapshot: inputs as Prisma.InputJsonValue,
            scheduleRevision: schedule.revision,
            requestId: randomUUID()
          }
        ],
        skipDuplicates: true
      });
      const run = await transaction.workflowScheduleRun.findFirstOrThrow({
        where: { scheduleId: schedule.id, scheduledFor },
        select: { id: true, status: true, scheduledFor: true }
      });
      if (inserted.count === 1) {
        await transaction.workflowScheduleJob.create({
          data: { scheduleRunId: run.id }
        });
      }
      return {
        runId: run.id,
        status: run.status,
        scheduledFor: run.scheduledFor,
        existing: inserted.count === 0
      };
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

  /** 跨 Workspace 读取到期候选；真正的状态确认和推进在单 Schedule 锁事务中完成。 */
  async claimDueSchedules(now: Date, limit: number): Promise<DueScheduleClaim[]> {
    this.validDate(now, "now");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AppError(ErrorCodes.common.badRequest, "limit 必须是 1 到 1000 之间的整数");
    }
    const rows = await this.prisma.workflowSchedule.findMany({
      where: {
        status: WorkflowScheduleStatus.ACTIVE,
        nextRunAt: { lte: now }
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, workspaceId: true, nextRunAt: true }
    });
    return rows.flatMap((row) =>
      row.nextRunAt
        ? [{ scheduleId: row.id, workspaceId: row.workspaceId, nextRunAt: row.nextRunAt }]
        : []
    );
  }

  /**
   * 锁定一个 Schedule 后，在同一短事务内创建 Run、Outbox 并推进 nextRunAt。
   * 不能先推进时间再创建 Run，否则事务中途失败会永久丢失计划执行点。
   */
  async materializeDueRuns(scheduleId: string, now: Date): Promise<MaterializedScheduleRuns> {
    const id = this.id(scheduleId, "scheduleId");
    this.validDate(now, "now");

    return this.prisma.$transaction(async (transaction) => {
      // SKIP LOCKED 让多个 Scheduler 跳过正在处理的同一任务，同时仍可并行处理其他任务。
      const rows = await transaction.$queryRaw<LockedSchedule[]>`
        SELECT
          id,
          workspace_id AS "workspaceId",
          workflow_id AS "workflowId",
          workflow_version_id AS "workflowVersionId",
          status,
          cron_expression AS "cronExpression",
          timezone,
          inputs,
          misfire_policy AS "misfirePolicy",
          max_catch_up_runs AS "maxCatchUpRuns",
          next_run_at AS "nextRunAt",
          revision
        FROM workflow_schedules
        WHERE id = ${id}::uuid
        FOR UPDATE SKIP LOCKED
      `;
      const schedule = rows[0];
      if (!schedule) return this.emptyMaterialization(id, false, null);
      if (
        schedule.status !== WorkflowScheduleStatus.ACTIVE ||
        !schedule.nextRunAt ||
        schedule.nextRunAt.getTime() > now.getTime()
      ) {
        return this.emptyMaterialization(id, true, schedule.nextRunAt);
      }

      const due = this.planner.resolveDueOccurrences(
        {
          cronExpression: schedule.cronExpression,
          timezone: schedule.timezone,
          nextRunAt: schedule.nextRunAt,
          misfirePolicy: schedule.misfirePolicy,
          maxCatchUpRuns: schedule.maxCatchUpRuns
        },
        now
      );
      const inputs = this.jsonObject(schedule.inputs);
      const runData = due.occurrences.map((scheduledFor) => ({
        id: randomUUID(),
        workspaceId: schedule.workspaceId,
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        workflowVersionId: schedule.workflowVersionId,
        scheduledFor,
        trigger: WorkflowScheduleRunTrigger.SCHEDULED,
        status: WorkflowScheduleRunStatus.QUEUED,
        inputSnapshot: inputs as Prisma.InputJsonValue,
        scheduleRevision: schedule.revision,
        requestId: randomUUID()
      }));
      const inserted =
        runData.length === 0
          ? { count: 0 }
          : await transaction.workflowScheduleRun.createMany({
              data: runData,
              skipDuplicates: true
            });
      const runs =
        due.occurrences.length === 0
          ? []
          : await transaction.workflowScheduleRun.findMany({
              where: {
                scheduleId: schedule.id,
                scheduledFor: { in: due.occurrences }
              },
              select: { id: true }
            });
      if (runs.length > 0) {
        await transaction.workflowScheduleJob.createMany({
          data: runs.map((run) => ({ scheduleRunId: run.id })),
          skipDuplicates: true
        });
      }
      const lastScheduledAt =
        due.occurrences.at(-1) ?? (due.skippedCount > 0 ? schedule.nextRunAt : undefined);
      await transaction.workflowSchedule.update({
        where: { id: schedule.id },
        data: {
          nextRunAt: due.nextRunAt,
          ...(lastScheduledAt ? { lastScheduledAt } : {})
        }
      });
      return {
        scheduleId: schedule.id,
        createdRunCount: inserted.count,
        duplicateRunCount: Math.max(0, due.occurrences.length - inserted.count),
        skippedCount: due.skippedCount,
        skippedCountTruncated: due.skippedCountTruncated,
        nextRunAt: due.nextRunAt,
        locked: true
      };
    });
  }

  async claimPendingScheduleJobs(
    now: Date,
    limit: number
  ): Promise<WorkflowScheduleJobDispatchDto[]> {
    this.validDate(now, "now");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new AppError(ErrorCodes.common.badRequest, "limit 必须是 1 到 1000 之间的整数");
    }
    const jobs = await this.prisma.workflowScheduleJob.findMany({
      where: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING,
        nextDispatchAt: { lte: now }
      },
      orderBy: [{ nextDispatchAt: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, scheduleRunId: true, dispatchAttempts: true }
    });
    return jobs.map((job) => ({
      jobId: job.id,
      scheduleRunId: job.scheduleRunId,
      dispatchAttempts: job.dispatchAttempts
    }));
  }

  async markScheduleJobDispatched(jobId: string): Promise<void> {
    await this.prisma.workflowScheduleJob.updateMany({
      where: {
        id: this.id(jobId, "jobId"),
        dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING
      },
      data: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.DISPATCHED,
        dispatchAttempts: { increment: 1 },
        dispatchedAt: new Date(),
        lastErrorCode: null
      }
    });
  }

  async rescheduleScheduleJob(
    jobId: string,
    errorCode: string,
    nextDispatchAt: Date
  ): Promise<void> {
    this.validDate(nextDispatchAt, "nextDispatchAt");
    await this.prisma.workflowScheduleJob.updateMany({
      where: {
        id: this.id(jobId, "jobId"),
        dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING
      },
      data: {
        dispatchAttempts: { increment: 1 },
        lastErrorCode: this.errorCode(errorCode),
        nextDispatchAt
      }
    });
  }

  async markScheduleJobDead(jobId: string, errorCode: string): Promise<void> {
    await this.prisma.workflowScheduleJob.updateMany({
      where: { id: this.id(jobId, "jobId") },
      data: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.DEAD,
        dispatchAttempts: { increment: 1 },
        lastErrorCode: this.errorCode(errorCode)
      }
    });
  }

  /** QUEUED -> RUNNING 条件更新是重复 Job 投递下的唯一执行权。 */
  async claimScheduleRunExecution(
    scheduleRunId: string,
    workerIdValue: string
  ): Promise<WorkflowScheduleRunExecution | null> {
    const id = this.id(scheduleRunId, "scheduleRunId");
    const workerId = this.id(workerIdValue, "workerId");
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.workflowScheduleRun.findUnique({
        where: { id },
        select: { scheduleId: true }
      });
      if (!candidate) return null;
      // 同一 Schedule 的检查和状态切换必须串行；不同 Schedule 仍可被多个 Worker 并行认领。
      // PostgreSQL advisory lock 返回 void，Prisma 无法反序列化该类型；显式转成 text，
      // 既保留事务级锁语义，也避免 Worker 在领取任务时因结果解码失败而退出。
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${candidate.scheduleId}::text, 0))::text
      `;
      const current = await transaction.workflowScheduleRun.findUnique({
        where: { id },
        include: {
          schedule: {
            select: { timeoutSeconds: true, concurrencyPolicy: true, status: true }
          }
        }
      });
      if (!current || current.status !== WorkflowScheduleRunStatus.QUEUED) return null;
      if (
        current.cancelRequestedAt ||
        current.schedule.status === WorkflowScheduleStatus.ARCHIVED
      ) {
        await this.cancelQueuedRun(transaction, current.id, current.scheduleId);
        return null;
      }
      const runningCount = await transaction.workflowScheduleRun.count({
        where: {
          scheduleId: current.scheduleId,
          status: WorkflowScheduleRunStatus.RUNNING
        }
      });
      const atConcurrencyLimit =
        current.schedule.concurrencyPolicy === PrismaConcurrencyPolicy.QUEUE
          ? runningCount > 0
          : current.schedule.concurrencyPolicy === PrismaConcurrencyPolicy.SKIP
            ? runningCount > 0
            : runningCount >= MAX_PARALLEL_SCHEDULE_RUNS;
      if (atConcurrencyLimit) {
        if (current.schedule.concurrencyPolicy === PrismaConcurrencyPolicy.SKIP) {
          await this.skipOverlappingRun(transaction, current.id, current.scheduleId);
        } else {
          await this.deferScheduleRun(transaction, current.id);
        }
        return null;
      }
      const startedAt = new Date();
      const claimed = await transaction.workflowScheduleRun.updateMany({
        where: {
          id,
          status: WorkflowScheduleRunStatus.QUEUED,
          cancelRequestedAt: null
        },
        data: {
          status: WorkflowScheduleRunStatus.RUNNING,
          workerId,
          attempt: { increment: 1 },
          startedAt,
          heartbeatAt: startedAt
        }
      });
      if (claimed.count !== 1) return null;
      await transaction.workflowSchedule.update({
        where: { id: current.scheduleId },
        data: { lastStartedAt: startedAt }
      });
      return {
        scheduleRunId: current.id,
        workspaceId: current.workspaceId,
        scheduleId: current.scheduleId,
        workflowId: current.workflowId,
        workflowVersionId: current.workflowVersionId,
        requestId: current.requestId,
        inputs: this.jsonObject(current.inputSnapshot),
        timeoutSeconds: current.schedule.timeoutSeconds,
        agentRunId: current.agentRunId
      };
    });
  }

  /** QUEUED 可直接取消；RUNNING 只写请求时间，由持有 AbortController 的 Worker 收敛终态。 */
  async requestScheduleRunCancel(runIdValue: string): Promise<WorkflowScheduleRunCancelResult> {
    const id = this.id(runIdValue, "runId");
    return this.prisma.$transaction(async (transaction) => {
      const run = await transaction.workflowScheduleRun.findFirst({
        where: { id, workspaceId: requireWorkspaceId() },
        select: { id: true, scheduleId: true, status: true, cancelRequestedAt: true }
      });
      if (!run) throw this.notFound();
      if (run.status === WorkflowScheduleRunStatus.QUEUED) {
        const cancelRequestedAt = new Date();
        await transaction.workflowScheduleRun.update({
          where: { id },
          data: {
            status: WorkflowScheduleRunStatus.CANCELED,
            cancelRequestedAt,
            finishedAt: cancelRequestedAt,
            errorType: "schedule_run_canceled",
            errorMessage: "定时运行已在开始前取消"
          }
        });
        await transaction.workflowScheduleJob.updateMany({
          where: { scheduleRunId: id },
          data: { dispatchStatus: WorkflowScheduleJobDispatchStatus.COMPLETED }
        });
        await transaction.workflowSchedule.update({
          where: { id: run.scheduleId },
          data: { lastFinishedAt: cancelRequestedAt }
        });
        return { runId: id, status: "CANCELED", cancelRequestedAt };
      }
      if (run.status === WorkflowScheduleRunStatus.RUNNING) {
        const cancelRequestedAt = run.cancelRequestedAt ?? new Date();
        if (!run.cancelRequestedAt) {
          await transaction.workflowScheduleRun.update({
            where: { id },
            data: { cancelRequestedAt }
          });
        }
        return { runId: id, status: "RUNNING", cancelRequestedAt };
      }
      return {
        runId: id,
        status: run.status,
        cancelRequestedAt: run.cancelRequestedAt
      };
    });
  }

  async heartbeatScheduleRun(scheduleRunId: string, workerId: string): Promise<boolean> {
    const updated = await this.prisma.workflowScheduleRun.updateMany({
      where: {
        id: this.id(scheduleRunId, "scheduleRunId"),
        workerId: this.id(workerId, "workerId"),
        status: WorkflowScheduleRunStatus.RUNNING
      },
      data: { heartbeatAt: new Date() }
    });
    return updated.count === 1;
  }

  async isScheduleRunCancellationRequested(scheduleRunId: string): Promise<boolean> {
    const run = await this.prisma.workflowScheduleRun.findUnique({
      where: { id: this.id(scheduleRunId, "scheduleRunId") },
      select: { status: true, cancelRequestedAt: true }
    });
    return Boolean(run?.cancelRequestedAt || run?.status === WorkflowScheduleRunStatus.CANCELED);
  }

  async listStaleRunningScheduleRuns(
    staleBefore: Date,
    limit: number
  ): Promise<WorkflowScheduleStaleRun[]> {
    this.validDate(staleBefore, "staleBefore");
    const runs = await this.prisma.workflowScheduleRun.findMany({
      where: {
        status: WorkflowScheduleRunStatus.RUNNING,
        OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null }]
      },
      orderBy: { updatedAt: "asc" },
      take: this.reconciliationLimit(limit),
      select: { id: true, scheduleId: true, agentRunId: true, startedAt: true }
    });
    return runs.map((run) => ({
      scheduleRunId: run.id,
      scheduleId: run.scheduleId,
      agentRunId: run.agentRunId,
      startedAt: run.startedAt
    }));
  }

  async listLinkedRunningScheduleRuns(limit: number): Promise<WorkflowScheduleLinkedRun[]> {
    const runs = await this.prisma.workflowScheduleRun.findMany({
      where: { status: WorkflowScheduleRunStatus.RUNNING, agentRunId: { not: null } },
      orderBy: { updatedAt: "asc" },
      take: this.reconciliationLimit(limit),
      select: { id: true, agentRunId: true }
    });
    return runs.flatMap((run) =>
      run.agentRunId ? [{ scheduleRunId: run.id, agentRunId: run.agentRunId }] : []
    );
  }

  async listStaleDispatchedScheduleJobs(
    staleBefore: Date,
    limit: number
  ): Promise<WorkflowScheduleDispatchedJob[]> {
    this.validDate(staleBefore, "staleBefore");
    const jobs = await this.prisma.workflowScheduleJob.findMany({
      where: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.DISPATCHED,
        updatedAt: { lt: staleBefore },
        scheduleRun: { status: WorkflowScheduleRunStatus.QUEUED }
      },
      orderBy: { updatedAt: "asc" },
      take: this.reconciliationLimit(limit),
      select: { id: true, scheduleRunId: true }
    });
    return jobs.map((job) => ({ jobId: job.id, scheduleRunId: job.scheduleRunId }));
  }

  async rescheduleLostDispatchedJob(jobId: string): Promise<boolean> {
    const updated = await this.prisma.workflowScheduleJob.updateMany({
      where: {
        id: this.id(jobId, "jobId"),
        dispatchStatus: WorkflowScheduleJobDispatchStatus.DISPATCHED,
        scheduleRun: { status: WorkflowScheduleRunStatus.QUEUED }
      },
      data: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING,
        nextDispatchAt: new Date(),
        lastErrorCode: "bullmq_job_lost"
      }
    });
    return updated.count === 1;
  }

  /** 只有从未开始且没有 Trace 的失联记录可安全回到 QUEUED；其余一律保守失败。 */
  async reconcileStaleRunningScheduleRun(
    run: WorkflowScheduleStaleRun
  ): Promise<"REQUEUED" | "FAILED" | "UNCHANGED"> {
    const id = this.id(run.scheduleRunId, "scheduleRunId");
    if (!run.agentRunId && !run.startedAt) {
      return this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.workflowScheduleRun.updateMany({
          where: {
            id,
            status: WorkflowScheduleRunStatus.RUNNING,
            agentRunId: null,
            startedAt: null
          },
          data: { status: WorkflowScheduleRunStatus.QUEUED, workerId: null, heartbeatAt: null }
        });
        if (updated.count !== 1) return "UNCHANGED" as const;
        await transaction.workflowScheduleJob.updateMany({
          where: { scheduleRunId: id },
          data: {
            dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING,
            nextDispatchAt: new Date(),
            lastErrorCode: "worker_lost_before_start"
          }
        });
        return "REQUEUED" as const;
      });
    }
    return this.prisma.$transaction(async (transaction) => {
      const finishedAt = new Date();
      const failed = await transaction.workflowScheduleRun.updateMany({
        where: { id, status: WorkflowScheduleRunStatus.RUNNING },
        data: {
          status: WorkflowScheduleRunStatus.FAILED,
          finishedAt,
          errorType: "worker_lost",
          errorMessage: "Worker 心跳超时，因可能已产生副作用而禁止自动重跑"
        }
      });
      if (failed.count !== 1) return "UNCHANGED" as const;
      await transaction.workflowScheduleJob.updateMany({
        where: { scheduleRunId: id },
        data: { dispatchStatus: WorkflowScheduleJobDispatchStatus.COMPLETED }
      });
      await transaction.workflowSchedule.update({
        where: { id: run.scheduleId },
        data: { lastFinishedAt: finishedAt }
      });
      return "FAILED" as const;
    });
  }

  async cancelArchivedQueuedScheduleRuns(limit: number): Promise<number> {
    const runs = await this.prisma.workflowScheduleRun.findMany({
      where: {
        status: WorkflowScheduleRunStatus.QUEUED,
        schedule: { status: WorkflowScheduleStatus.ARCHIVED }
      },
      orderBy: { createdAt: "asc" },
      take: this.reconciliationLimit(limit),
      select: { id: true, scheduleId: true }
    });
    for (const run of runs) {
      await this.prisma.$transaction((transaction) =>
        this.cancelQueuedRun(transaction, run.id, run.scheduleId)
      );
    }
    return runs.length;
  }

  /** Worker 执行前重新读取版本 Graph，防止 MCP Tool 后续改为 CONFIRM 后仍无人值守运行。 */
  async assertScheduleRunExecutable(run: WorkflowScheduleRunExecution): Promise<void> {
    const version = await this.prisma.workflowVersion.findFirst({
      where: {
        id: run.workflowVersionId,
        workflowId: run.workflowId,
        workspaceId: run.workspaceId
      },
      select: { id: true, workflowId: true, version: true, graph: true }
    });
    if (!version) {
      throw new AppError(
        ErrorCodes.workflow.scheduleVersionInvalid,
        "定时运行引用的 Workflow Version 不存在",
        HttpStatus.CONFLICT
      );
    }
    await this.validateVersionForSchedule(version, run.inputs);
  }

  async linkScheduleRunAgentRun(scheduleRunId: string, agentRunId: string): Promise<void> {
    const id = this.id(scheduleRunId, "scheduleRunId");
    const normalizedAgentRunId = this.id(agentRunId, "agentRunId");
    const linked = await this.prisma.workflowScheduleRun.updateMany({
      where: {
        id,
        status: WorkflowScheduleRunStatus.RUNNING,
        agentRunId: null
      },
      data: { agentRunId: normalizedAgentRunId }
    });
    if (linked.count === 1) return;
    const current = await this.prisma.workflowScheduleRun.findUnique({
      where: { id },
      select: { agentRunId: true }
    });
    if (current?.agentRunId === normalizedAgentRunId) return;
    throw new AppError(
      ErrorCodes.common.conflict,
      "ScheduleRun 无法关联 Agent Run",
      HttpStatus.CONFLICT
    );
  }

  async finishScheduleRun(
    scheduleRunId: string,
    status: WorkflowScheduleRunTerminalStatus,
    error?: { type: string; message: string }
  ): Promise<void> {
    const id = this.id(scheduleRunId, "scheduleRunId");
    const finishedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const run = await transaction.workflowScheduleRun.findUnique({
        where: { id },
        select: { scheduleId: true, status: true }
      });
      if (!run || run.status !== WorkflowScheduleRunStatus.RUNNING) return;
      await transaction.workflowScheduleRun.update({
        where: { id },
        data: {
          status,
          finishedAt,
          heartbeatAt: finishedAt,
          ...(error
            ? {
                errorType: this.errorCode(error.type),
                errorMessage: error.message.slice(0, 2_000)
              }
            : { errorType: null, errorMessage: null })
        }
      });
      await transaction.workflowSchedule.update({
        where: { id: run.scheduleId },
        data: { lastFinishedAt: finishedAt }
      });
      await transaction.workflowScheduleJob.updateMany({
        where: { scheduleRunId: id },
        data: { dispatchStatus: WorkflowScheduleJobDispatchStatus.COMPLETED }
      });
    });
  }

  private async deferScheduleRun(
    transaction: TransactionClient,
    scheduleRunId: string
  ): Promise<void> {
    await transaction.workflowScheduleJob.updateMany({
      where: { scheduleRunId },
      data: {
        dispatchStatus: WorkflowScheduleJobDispatchStatus.PENDING,
        nextDispatchAt: new Date(Date.now() + CONCURRENCY_RETRY_DELAY_MS),
        lastErrorCode: "schedule_concurrency_deferred"
      }
    });
  }

  private async skipOverlappingRun(
    transaction: TransactionClient,
    scheduleRunId: string,
    scheduleId: string
  ): Promise<void> {
    const finishedAt = new Date();
    await transaction.workflowScheduleRun.update({
      where: { id: scheduleRunId },
      data: {
        status: WorkflowScheduleRunStatus.SKIPPED,
        finishedAt,
        errorType: "schedule_overlap_skipped",
        errorMessage: "同一定时任务已有运行实例，本次按 SKIP 策略跳过"
      }
    });
    await transaction.workflowScheduleJob.updateMany({
      where: { scheduleRunId },
      data: { dispatchStatus: WorkflowScheduleJobDispatchStatus.COMPLETED }
    });
    await transaction.workflowSchedule.update({
      where: { id: scheduleId },
      data: { lastFinishedAt: finishedAt }
    });
  }

  private async cancelQueuedRun(
    transaction: TransactionClient,
    scheduleRunId: string,
    scheduleId: string
  ): Promise<void> {
    const finishedAt = new Date();
    await transaction.workflowScheduleRun.update({
      where: { id: scheduleRunId },
      data: {
        status: WorkflowScheduleRunStatus.CANCELED,
        cancelRequestedAt: finishedAt,
        finishedAt,
        errorType: "schedule_run_canceled",
        errorMessage: "定时运行已取消或所属 Schedule 已归档"
      }
    });
    await transaction.workflowScheduleJob.updateMany({
      where: { scheduleRunId },
      data: { dispatchStatus: WorkflowScheduleJobDispatchStatus.COMPLETED }
    });
    await transaction.workflowSchedule.update({
      where: { id: scheduleId },
      data: { lastFinishedAt: finishedAt }
    });
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

  private emptyMaterialization(
    scheduleId: string,
    locked: boolean,
    nextRunAt: Date | null
  ): MaterializedScheduleRuns {
    return {
      scheduleId,
      createdRunCount: 0,
      duplicateRunCount: 0,
      skippedCount: 0,
      skippedCountTruncated: false,
      nextRunAt,
      locked
    };
  }

  private validDate(value: Date, field: string): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} 必须是有效时间`);
    }
  }

  private reconciliationLimit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 1_000) {
      throw new AppError(ErrorCodes.common.badRequest, "limit 必须是 1 到 1000 之间的整数");
    }
    return value;
  }

  private errorCode(value: string): string {
    const normalized = value.trim().slice(0, 120);
    return normalized || "QUEUE_ERROR";
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

  private toListItem(schedule: ScheduleRecord, consecutiveFailures = 0): WorkflowScheduleListItem {
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
      updatedAt: schedule.updatedAt,
      consecutiveFailures
    };
  }

  private toDetail(schedule: ScheduleRecord, consecutiveFailures = 0): WorkflowScheduleDetail {
    return {
      ...this.toListItem(schedule, consecutiveFailures),
      inputs: this.jsonObject(schedule.inputs)
    };
  }

  private async getConsecutiveFailures(scheduleId: string): Promise<number> {
    const runs = await this.prisma.workflowScheduleRun.findMany({
      where: {
        scheduleId,
        status: {
          in: [
            WorkflowScheduleRunStatus.COMPLETED,
            WorkflowScheduleRunStatus.FAILED,
            WorkflowScheduleRunStatus.CANCELED,
            WorkflowScheduleRunStatus.TIMED_OUT,
            WorkflowScheduleRunStatus.SKIPPED
          ]
        }
      },
      orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      take: 20,
      select: { status: true }
    });
    let count = 0;
    for (const run of runs) {
      if (
        run.status !== WorkflowScheduleRunStatus.FAILED &&
        run.status !== WorkflowScheduleRunStatus.TIMED_OUT
      ) {
        break;
      }
      count += 1;
    }
    return count;
  }

  private toRunListItem(
    run: WorkflowScheduleRun,
    workflowVersion: number
  ): WorkflowScheduleRunListItem {
    return {
      id: run.id,
      scheduleId: run.scheduleId,
      workflowId: run.workflowId,
      workflowVersionId: run.workflowVersionId,
      workflowVersion,
      trigger: run.trigger,
      status: run.status,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      queueWaitMs: run.startedAt
        ? Math.max(0, run.startedAt.getTime() - run.scheduledFor.getTime())
        : null,
      durationMs:
        run.startedAt && run.finishedAt
          ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())
          : null,
      attempt: run.attempt,
      agentRunId: run.agentRunId,
      errorType: run.errorType,
      errorMessage: run.errorMessage
    };
  }

  private runStatus(value: unknown): WorkflowScheduleRunStatus | undefined {
    if (value === undefined || value === "") return undefined;
    if (!Object.values(WorkflowScheduleRunStatus).includes(value as WorkflowScheduleRunStatus)) {
      throw new AppError(ErrorCodes.common.badRequest, "Schedule Run status 无效");
    }
    return value as WorkflowScheduleRunStatus;
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

  private retentionDays(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 1 || value > 3_650) {
      throw new AppError(ErrorCodes.common.badRequest, `${field} 必须是 1 到 3650 之间的整数`);
    }
    return value;
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
