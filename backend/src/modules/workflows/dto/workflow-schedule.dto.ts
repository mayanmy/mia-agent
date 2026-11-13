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

/** 同时返回 UTC 与任务时区时间，避免前端自行重复计算 DST。 */
export type WorkflowScheduleOccurrence = {
  scheduledFor: string;
  localTime: string;
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
