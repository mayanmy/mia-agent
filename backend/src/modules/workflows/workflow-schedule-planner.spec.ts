import * as assert from "node:assert/strict";

import { AppError, ErrorCodes } from "../../core/errors";
import { WorkflowScheduleDueInput } from "./dto/workflow-schedule.dto";
import {
  MAX_WORKFLOW_SCHEDULE_INPUT_BYTES,
  WorkflowSchedulePlanner
} from "./workflow-schedule-planner";

const planner = new WorkflowSchedulePlanner();

function assertAppErrorCode(error: unknown, code: number): boolean {
  return error instanceof AppError && error.code === code;
}

function dueInput(overrides: Partial<WorkflowScheduleDueInput> = {}): WorkflowScheduleDueInput {
  return {
    cronExpression: "* * * * *",
    timezone: "UTC",
    nextRunAt: new Date("2026-11-13T00:01:00.000Z"),
    misfirePolicy: "RUN_ONCE",
    maxCatchUpRuns: 2,
    ...overrides
  };
}

export const tests = [
  {
    name: "WorkflowSchedulePlanner previews deterministic UTC and local occurrences",
    run: () => {
      const result = planner.preview(
        "0 9 * * 1-5",
        "Asia/Shanghai",
        new Date("2026-11-13T00:00:00.000Z")
      );

      assert.equal(result.length, 5);
      assert.deepEqual(result[0], {
        scheduledFor: "2026-11-13T01:00:00.000Z",
        localTime: "2026-11-13 09:00:00 +08:00"
      });
      assert.equal(result[1]?.scheduledFor, "2026-11-16T01:00:00.000Z");
    }
  },
  {
    name: "WorkflowSchedulePlanner rejects non-five-field and extended Cron syntax",
    run: () => {
      assert.throws(
        () => planner.validate("0 0 9 * * 1-5", "UTC"),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInvalidCron)
      );
      assert.throws(
        () => planner.validate("H 9 * * *", "UTC"),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInvalidCron)
      );
      assert.throws(
        () => planner.validate("0 0 31 2 *", "UTC"),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInvalidCron)
      );
    }
  },
  {
    name: "WorkflowSchedulePlanner rejects invalid IANA timezones",
    run: () => {
      assert.throws(
        () => planner.validate("0 9 * * *", "Mars/Olympus_Mons"),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInvalidTimezone)
      );
    }
  },
  {
    name: "WorkflowSchedulePlanner skips nonexistent DST wall-clock occurrences",
    run: () => {
      const result = planner.preview(
        "30 2 * * *",
        "America/New_York",
        new Date("2026-03-08T06:00:00.000Z"),
        2
      );

      assert.deepEqual(
        result.map((item) => item.scheduledFor),
        ["2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]
      );
      assert.equal(result[0]?.localTime, "2026-03-09 02:30:00 -04:00");
    }
  },
  {
    name: "WorkflowSchedulePlanner applies SKIP misfire policy",
    run: () => {
      const result = planner.resolveDueOccurrences(
        dueInput({ misfirePolicy: "SKIP" }),
        new Date("2026-11-13T00:05:30.000Z")
      );

      assert.deepEqual(result.occurrences, []);
      assert.equal(result.skippedCount, 5);
      assert.equal(result.skippedCountTruncated, false);
      assert.equal(result.nextRunAt.toISOString(), "2026-11-13T00:06:00.000Z");
    }
  },
  {
    name: "WorkflowSchedulePlanner applies RUN_ONCE misfire policy to the latest due occurrence",
    run: () => {
      const result = planner.resolveDueOccurrences(
        dueInput({ misfirePolicy: "RUN_ONCE" }),
        new Date("2026-11-13T00:05:30.000Z")
      );

      assert.deepEqual(
        result.occurrences.map((date) => date.toISOString()),
        ["2026-11-13T00:05:00.000Z"]
      );
      assert.equal(result.skippedCount, 4);
      assert.equal(result.nextRunAt.toISOString(), "2026-11-13T00:06:00.000Z");
    }
  },
  {
    name: "WorkflowSchedulePlanner caps CATCH_UP occurrences and advances past the due window",
    run: () => {
      const result = planner.resolveDueOccurrences(
        dueInput({ misfirePolicy: "CATCH_UP", maxCatchUpRuns: 2 }),
        new Date("2026-11-13T00:05:30.000Z")
      );

      assert.deepEqual(
        result.occurrences.map((date) => date.toISOString()),
        ["2026-11-13T00:01:00.000Z", "2026-11-13T00:02:00.000Z"]
      );
      assert.equal(result.skippedCount, 3);
      assert.equal(result.nextRunAt.toISOString(), "2026-11-13T00:06:00.000Z");
    }
  },
  {
    name: "WorkflowSchedulePlanner preserves a future nextRunAt without creating occurrences",
    run: () => {
      const result = planner.resolveDueOccurrences(
        dueInput({ nextRunAt: new Date("2026-11-13T00:10:00.000Z") }),
        new Date("2026-11-13T00:05:30.000Z")
      );

      assert.deepEqual(result.occurrences, []);
      assert.equal(result.nextRunAt.toISOString(), "2026-11-13T00:10:00.000Z");
      assert.equal(result.skippedCount, 0);
    }
  },
  {
    name: "WorkflowSchedulePlanner validates policy, catch-up, preview and timeout bounds",
    run: () => {
      assert.throws(
        () =>
          planner.resolveDueOccurrences(
            dueInput({ misfirePolicy: "INVALID" as never }),
            new Date("2026-11-13T00:05:30.000Z")
          ),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInvalidPolicy)
      );
      assert.throws(
        () =>
          planner.resolveDueOccurrences(
            dueInput({ maxCatchUpRuns: 11 }),
            new Date("2026-11-13T00:05:30.000Z")
          ),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleCatchUpLimitInvalid)
      );
      assert.throws(
        () => planner.preview("0 9 * * *", "UTC", new Date(), 0),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.schedulePreviewCountInvalid)
      );
      assert.throws(
        () => planner.validateTimeoutSeconds(59),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleTimeoutInvalid)
      );
      planner.validateTimeoutSeconds(60);
      planner.validateTimeoutSeconds(86_400);
    }
  },
  {
    name: "WorkflowSchedulePlanner enforces serialized input byte limits",
    run: () => {
      planner.validateInputSize({ value: "ok" });
      assert.throws(
        () => planner.validateInputSize({ value: "x".repeat(MAX_WORKFLOW_SCHEDULE_INPUT_BYTES) }),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInputTooLarge)
      );
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      assert.throws(
        () => planner.validateInputSize(circular),
        (error) => assertAppErrorCode(error, ErrorCodes.workflow.scheduleInputTooLarge)
      );
    }
  }
];
