/** Workflow 定时任务首期支持的漏跑策略。 */
export const WORKFLOW_SCHEDULE_MISFIRE_POLICIES = ["SKIP", "RUN_ONCE", "CATCH_UP"] as const;

export type WorkflowScheduleMisfirePolicy = (typeof WORKFLOW_SCHEDULE_MISFIRE_POLICIES)[number];

/** Workflow 定时任务首期支持的并发策略。 */
export const WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES = ["QUEUE", "SKIP", "ALLOW"] as const;

export type WorkflowScheduleConcurrencyPolicy =
  (typeof WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES)[number];

/** Cron 预览输入；Controller 接入后仍由 Planner 执行最终校验。 */
export type WorkflowSchedulePreviewDto = {
  cronExpression?: string;
  timezone?: string;
  from?: string;
};

/** 创建定时任务；状态不由请求控制，P1 一律以 PAUSED 落库。 */
export type WorkflowScheduleCreateDto = {
  name?: string;
  description?: string;
  workflowVersionId?: string;
  cronExpression?: string;
  timezone?: string;
  inputs?: Record<string, unknown>;
  misfirePolicy?: WorkflowScheduleMisfirePolicy;
  concurrencyPolicy?: WorkflowScheduleConcurrencyPolicy;
  maxCatchUpRuns?: number;
  timeoutSeconds?: number;
};

/** 更新时必须携带 revision，所有可变配置一次完成乐观锁写入。 */
export type WorkflowScheduleUpdateDto = Partial<WorkflowScheduleCreateDto> & {
  revision?: number;
};

/** 暂停、恢复和归档等状态写同样使用乐观锁。 */
export type WorkflowScheduleRevisionDto = {
  revision?: number;
};

/** 升级只允许切换到同一 Workflow 的不可变发布版本。 */
export type WorkflowScheduleUpgradeVersionDto = WorkflowScheduleRevisionDto & {
  workflowVersionId?: string;
};

/** 同时返回 UTC 与任务时区时间，避免前端自行重复计算 DST。 */
export type WorkflowScheduleOccurrence = {
  scheduledFor: string;
  localTime: string;
};

/** 预览结果由后端统一计算，前端不得自行解释 Cron 或 DST。 */
export type WorkflowSchedulePreview = {
  cronExpression: string;
  timezone: string;
  nextOccurrences: WorkflowScheduleOccurrence[];
};

/** 管理列表与详情共享稳定字段，不向 Controller 暴露 Prisma Model。 */
export type WorkflowScheduleListItem = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  name: string;
  description: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  cronExpression: string;
  timezone: string;
  misfirePolicy: WorkflowScheduleMisfirePolicy;
  concurrencyPolicy: WorkflowScheduleConcurrencyPolicy;
  maxCatchUpRuns: number;
  timeoutSeconds: number;
  nextRunAt: Date | null;
  lastScheduledAt: Date | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  createdByUserId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowScheduleDetail = WorkflowScheduleListItem & {
  inputs: Record<string, unknown>;
};

/** 计算漏跑窗口所需的稳定业务字段，不传递数据库对象。 */
export type WorkflowScheduleDueInput = {
  cronExpression: string;
  timezone: string;
  nextRunAt: Date;
  misfirePolicy: WorkflowScheduleMisfirePolicy;
  maxCatchUpRuns: number;
};

export type WorkflowScheduleDueResult = {
  /** 本轮应该物化的计划时间点，按时间升序排列。 */
  occurrences: Date[];
  /** 第一个严格晚于本次计算时间的计划时间点。 */
  nextRunAt: Date;
  /** 本轮明确跳过的数量；过大窗口时是已确认的下限。 */
  skippedCount: number;
  /** true 表示为了限制 CPU，skippedCount 只记录下限而非完整数量。 */
  skippedCountTruncated: boolean;
};

/** Scheduler 跨 Workspace 扫描时只消费稳定标识，不暴露完整数据库记录。 */
export type DueScheduleClaim = {
  scheduleId: string;
  workspaceId: string;
  nextRunAt: Date;
};

/** 单个 Schedule 短事务的物化摘要，供 Scheduler 统计与日志使用。 */
export type MaterializedScheduleRuns = {
  scheduleId: string;
  createdRunCount: number;
  duplicateRunCount: number;
  skippedCount: number;
  skippedCountTruncated: boolean;
  nextRunAt: Date | null;
  locked: boolean;
};

/** Dispatcher 只接收 Outbox 和 Run 标识，Job Data 不携带输入、计划或密钥。 */
export type WorkflowScheduleJobDispatchDto = {
  jobId: string;
  scheduleRunId: string;
  dispatchAttempts: number;
};
