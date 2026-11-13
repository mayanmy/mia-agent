import { HttpStatus, Injectable } from "@nestjs/common";
import { CronExpression, CronExpressionParser } from "cron-parser";

import { AppError, ErrorCodes } from "../../core/errors";
import {
  WORKFLOW_SCHEDULE_MISFIRE_POLICIES,
  WorkflowScheduleDueInput,
  WorkflowScheduleDueResult,
  WorkflowScheduleMisfirePolicy,
  WorkflowScheduleOccurrence
} from "./dto/workflow-schedule.dto";

export const MAX_WORKFLOW_SCHEDULE_CRON_LENGTH = 120;
export const MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS = 10;
export const MAX_WORKFLOW_SCHEDULE_INPUT_BYTES = 64 * 1024;
export const MIN_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS = 60;
export const MAX_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS = 86_400;

const DEFAULT_PREVIEW_COUNT = 5;
const MAX_PREVIEW_COUNT = 50;
const MAX_ITERATIONS = 10_000;
const VALIDATION_REFERENCE_DATE = new Date("2024-01-01T00:00:00.000Z");
const WEEKDAYS = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6]
]);

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  offset: string;
};

/**
 * 统一 Cron、时区和漏跑计算。
 *
 * 第三方 Cron 类型只停留在本文件内，业务 Service 只消费 Date 和稳定 DTO；这样未来
 * 更换解析器时不会影响数据库、Controller、Worker 或前端契约。
 */
@Injectable()
export class WorkflowSchedulePlanner {
  validate(cronExpression: string, timezone: string): void {
    const expression = this.normalizeExpression(cronExpression);
    const normalizedTimezone = this.normalizeTimezone(timezone);

    try {
      const interval = this.parse(expression, normalizedTimezone, VALIDATION_REFERENCE_DATE);
      this.nextMatching(interval, normalizedTimezone);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.invalidCron(error);
    }
  }

  next(cronExpression: string, timezone: string, after: Date): Date {
    const expression = this.normalizeExpression(cronExpression);
    const normalizedTimezone = this.normalizeTimezone(timezone);
    this.requireValidDate(after, "after");

    try {
      return this.nextMatching(
        this.parse(expression, normalizedTimezone, after),
        normalizedTimezone
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.invalidCron(error);
    }
  }

  preview(
    cronExpression: string,
    timezone: string,
    after: Date,
    count = DEFAULT_PREVIEW_COUNT
  ): WorkflowScheduleOccurrence[] {
    const expression = this.normalizeExpression(cronExpression);
    const normalizedTimezone = this.normalizeTimezone(timezone);
    this.requireValidDate(after, "after");

    if (!Number.isInteger(count) || count < 1 || count > MAX_PREVIEW_COUNT) {
      throw new AppError(
        ErrorCodes.workflow.schedulePreviewCountInvalid,
        `预览次数必须是 1 到 ${MAX_PREVIEW_COUNT} 之间的整数`,
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const interval = this.parse(expression, normalizedTimezone, after);
      return Array.from({ length: count }, () => {
        const date = this.nextMatching(interval, normalizedTimezone);
        return {
          scheduledFor: date.toISOString(),
          localTime: this.formatLocalTime(date, normalizedTimezone)
        };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.invalidCron(error);
    }
  }

  resolveDueOccurrences(input: WorkflowScheduleDueInput, now: Date): WorkflowScheduleDueResult {
    const expression = this.normalizeExpression(input.cronExpression);
    const timezone = this.normalizeTimezone(input.timezone);
    const policy = this.normalizeMisfirePolicy(input.misfirePolicy);
    this.requireValidDate(input.nextRunAt, "nextRunAt");
    this.requireValidDate(now, "now");
    this.requireCatchUpLimit(input.maxCatchUpRuns);

    if (input.nextRunAt.getTime() > now.getTime()) {
      return {
        occurrences: [],
        nextRunAt: new Date(input.nextRunAt),
        skippedCount: 0,
        skippedCountTruncated: false
      };
    }

    if (!this.matchesExpression(expression, timezone, input.nextRunAt)) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        "定时任务 nextRunAt 与 Cron 表达式不一致",
        HttpStatus.BAD_REQUEST
      );
    }

    const firstDueAt = new Date(input.nextRunAt);
    const catchUpOccurrences: Date[] = [];
    let dueCount = 0;
    let cursor = firstDueAt;
    let latestScannedDueAt = firstDueAt;

    while (cursor.getTime() <= now.getTime() && dueCount < MAX_ITERATIONS) {
      dueCount += 1;
      latestScannedDueAt = new Date(cursor);
      if (catchUpOccurrences.length < input.maxCatchUpRuns) {
        catchUpOccurrences.push(new Date(cursor));
      }
      cursor = this.next(expression, timezone, cursor);
    }

    const truncated = cursor.getTime() <= now.getTime();
    const nextRunAt = truncated ? this.next(expression, timezone, now) : cursor;
    const latestDueAt = truncated
      ? this.previousOrAt(expression, timezone, now)
      : latestScannedDueAt;

    const occurrences = this.materializeOccurrences(policy, catchUpOccurrences, latestDueAt);
    return {
      occurrences,
      nextRunAt,
      skippedCount: Math.max(0, dueCount - occurrences.length),
      skippedCountTruncated: truncated
    };
  }

  validateInputSize(inputs: unknown): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(inputs);
    } catch {
      throw new AppError(
        ErrorCodes.workflow.scheduleInputTooLarge,
        "定时任务输入必须可序列化为 JSON",
        HttpStatus.BAD_REQUEST
      );
    }

    if (Buffer.byteLength(serialized ?? "null", "utf8") > MAX_WORKFLOW_SCHEDULE_INPUT_BYTES) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInputTooLarge,
        `定时任务输入不能超过 ${MAX_WORKFLOW_SCHEDULE_INPUT_BYTES} 字节`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  validateTimeoutSeconds(timeoutSeconds: number): void {
    if (
      !Number.isInteger(timeoutSeconds) ||
      timeoutSeconds < MIN_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS ||
      timeoutSeconds > MAX_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS
    ) {
      throw new AppError(
        ErrorCodes.workflow.scheduleTimeoutInvalid,
        `定时任务超时必须是 ${MIN_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS} 到 ${MAX_WORKFLOW_SCHEDULE_TIMEOUT_SECONDS} 之间的整数秒`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private materializeOccurrences(
    policy: WorkflowScheduleMisfirePolicy,
    catchUpOccurrences: Date[],
    latestDueAt: Date
  ): Date[] {
    if (policy === "SKIP") return [];
    if (policy === "RUN_ONCE") return [new Date(latestDueAt)];
    return catchUpOccurrences.map((date) => new Date(date));
  }

  private previousOrAt(cronExpression: string, timezone: string, now: Date): Date {
    try {
      // prev() 是严格早于 currentDate；增加 1 秒让恰好命中的分钟也能被返回。
      const interval = this.parse(cronExpression, timezone, new Date(now.getTime() + 1_000));
      for (let index = 0; index < MAX_ITERATIONS; index += 1) {
        const candidate = interval.prev().toDate();
        if (this.matchesFields(interval, candidate, timezone)) return candidate;
      }
      throw new Error("previous Cron occurrence search exceeded iteration limit");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.invalidCron(error);
    }
  }

  private nextMatching(interval: CronExpression, timezone: string): Date {
    for (let index = 0; index < MAX_ITERATIONS; index += 1) {
      const candidate = interval.next().toDate();
      // cron-parser 会把 DST 春季不存在的 02:30 平移到 03:30。Mia 的语义是跳过
      // 不存在的墙上时间，因此再次按原字段校验本地年月日时分。
      if (this.matchesFields(interval, candidate, timezone)) return candidate;
    }
    throw new Error("next Cron occurrence search exceeded iteration limit");
  }

  private matchesExpression(cronExpression: string, timezone: string, date: Date): boolean {
    const interval = this.parse(cronExpression, timezone, date);
    return this.matchesFields(interval, date, timezone);
  }

  private matchesFields(interval: CronExpression, date: Date, timezone: string): boolean {
    const parts = this.localDateParts(date, timezone);
    const fields = interval.fields;
    const includes = (values: readonly (number | string)[], value: number) =>
      values.some((item) => typeof item === "number" && item === value);
    const dayOfMonthMatches = includes(fields.dayOfMonth.values, parts.day);
    const dayOfWeekMatches = includes(fields.dayOfWeek.values, parts.weekday);
    const dayMatches =
      !fields.dayOfMonth.isWildcard && !fields.dayOfWeek.isWildcard
        ? dayOfMonthMatches || dayOfWeekMatches
        : dayOfMonthMatches && dayOfWeekMatches;

    return (
      parts.second === 0 &&
      includes(fields.minute.values, parts.minute) &&
      includes(fields.hour.values, parts.hour) &&
      dayMatches &&
      includes(fields.month.values, parts.month)
    );
  }

  private parse(cronExpression: string, timezone: string, currentDate: Date): CronExpression {
    return CronExpressionParser.parse(cronExpression, {
      currentDate,
      tz: timezone,
      // cron-parser strict 模式要求六段表达式；Mia 在入口强制五段，因此这里保持 false。
      strict: false
    });
  }

  private normalizeExpression(value: string): string {
    const expression = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
    if (!expression || expression.length > MAX_WORKFLOW_SCHEDULE_CRON_LENGTH) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        `Cron 表达式长度必须是 1 到 ${MAX_WORKFLOW_SCHEDULE_CRON_LENGTH} 个字符`,
        HttpStatus.BAD_REQUEST
      );
    }

    const fields = expression.split(" ");
    if (fields.length !== 5) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        "Cron 表达式必须使用分钟、小时、日、月、星期五个字段",
        HttpStatus.BAD_REQUEST
      );
    }

    if (fields.some((field) => this.hasUnsupportedCronExtension(field))) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        "Cron 表达式不能使用 H、L、?、# 等扩展语法",
        HttpStatus.BAD_REQUEST
      );
    }
    return expression;
  }

  private hasUnsupportedCronExtension(field: string): boolean {
    if (/[?#]/u.test(field)) return true;
    if (/(^|[,/-])H(?:\(|$|[,/-])/iu.test(field)) return true;
    return /(^|[,/-])(?:\d+)?L(?:$|[,/-])/iu.test(field);
  }

  private normalizeTimezone(value: string): string {
    const timezone = typeof value === "string" ? value.trim() : "";
    if (!timezone) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidTimezone,
        "定时任务时区不能为空",
        HttpStatus.BAD_REQUEST
      );
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(VALIDATION_REFERENCE_DATE);
      return timezone;
    } catch {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidTimezone,
        "定时任务时区必须是有效的 IANA 时区",
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private normalizeMisfirePolicy(value: string): WorkflowScheduleMisfirePolicy {
    if ((WORKFLOW_SCHEDULE_MISFIRE_POLICIES as readonly string[]).includes(value)) {
      return value as WorkflowScheduleMisfirePolicy;
    }
    throw new AppError(
      ErrorCodes.workflow.scheduleInvalidPolicy,
      "定时任务漏跑策略无效",
      HttpStatus.BAD_REQUEST
    );
  }

  private requireCatchUpLimit(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS) {
      throw new AppError(
        ErrorCodes.workflow.scheduleCatchUpLimitInvalid,
        `补跑上限必须是 1 到 ${MAX_WORKFLOW_SCHEDULE_CATCH_UP_RUNS} 之间的整数`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private requireValidDate(value: Date, name: string): void {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new AppError(
        ErrorCodes.workflow.scheduleInvalidCron,
        `${name} 必须是有效时间`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  private formatLocalTime(date: Date, timezone: string): string {
    const parts = this.localDateParts(date, timezone);
    return `${this.pad(parts.year, 4)}-${this.pad(parts.month)}-${this.pad(parts.day)} ${this.pad(parts.hour)}:${this.pad(parts.minute)}:${this.pad(parts.second)} ${parts.offset}`;
  }

  private localDateParts(date: Date, timezone: string): LocalDateParts {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      timeZoneName: "longOffset",
      hourCycle: "h23"
    });
    const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const weekday = WEEKDAYS.get(values.get("weekday") ?? "");
    if (weekday === undefined) throw new Error("failed to resolve local weekday");
    return {
      year: Number(values.get("year")),
      month: Number(values.get("month")),
      day: Number(values.get("day")),
      hour: Number(values.get("hour")),
      minute: Number(values.get("minute")),
      second: Number(values.get("second")),
      weekday,
      offset: this.normalizeOffset(values.get("timeZoneName") ?? "GMT")
    };
  }

  private normalizeOffset(value: string): string {
    if (value === "GMT" || value === "UTC") return "+00:00";
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u.exec(value);
    if (!match) return value;
    return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
  }

  private pad(value: number, length = 2): string {
    return String(value).padStart(length, "0");
  }

  private invalidCron(error: unknown): AppError {
    const detail = error instanceof Error && error.message ? `：${error.message}` : "";
    return new AppError(
      ErrorCodes.workflow.scheduleInvalidCron,
      `Cron 表达式无效${detail}`,
      HttpStatus.BAD_REQUEST
    );
  }
}
