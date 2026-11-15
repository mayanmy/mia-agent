-- P2 只物化计划执行点与可靠 Outbox，不启动 Workflow Runtime。
CREATE TYPE "workflow_schedule_run_status" AS ENUM (
  'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'TIMED_OUT', 'SKIPPED'
);
CREATE TYPE "workflow_schedule_run_trigger" AS ENUM ('SCHEDULED', 'MANUAL_BACKFILL');
CREATE TYPE "workflow_schedule_job_dispatch_status" AS ENUM (
  'PENDING', 'DISPATCHED', 'COMPLETED', 'DEAD'
);

CREATE TABLE "workflow_schedule_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "schedule_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "trigger" "workflow_schedule_run_trigger" NOT NULL,
  "status" "workflow_schedule_run_status" NOT NULL DEFAULT 'QUEUED',
  "input_snapshot" JSONB NOT NULL,
  "schedule_revision" INTEGER NOT NULL,
  "request_id" TEXT NOT NULL,
  "agent_run_id" UUID,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "worker_id" TEXT,
  "heartbeat_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "error_type" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_schedule_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_schedule_runs_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "workflow_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_schedule_runs_schedule_revision_check" CHECK ("schedule_revision" >= 1),
  CONSTRAINT "workflow_schedule_runs_attempt_check" CHECK ("attempt" >= 0)
);

CREATE TABLE "workflow_schedule_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_run_id" UUID NOT NULL,
  "dispatch_status" "workflow_schedule_job_dispatch_status" NOT NULL DEFAULT 'PENDING',
  "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_dispatch_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" TEXT,
  "dispatched_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_schedule_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_schedule_jobs_schedule_run_id_fkey"
    FOREIGN KEY ("schedule_run_id") REFERENCES "workflow_schedule_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_schedule_jobs_dispatch_attempts_check" CHECK ("dispatch_attempts" >= 0)
);

-- 计划时间与 Schedule 共同构成业务幂等键，多实例和重复扫描都不能产生重复 Run。
CREATE UNIQUE INDEX "uq_workflow_schedule_runs_occurrence"
  ON "workflow_schedule_runs"("schedule_id", "scheduled_for");
CREATE UNIQUE INDEX "uq_workflow_schedule_runs_agent_run"
  ON "workflow_schedule_runs"("agent_run_id");
CREATE UNIQUE INDEX "uq_workflow_schedule_jobs_run"
  ON "workflow_schedule_jobs"("schedule_run_id");
CREATE INDEX "idx_workflow_schedule_runs_status"
  ON "workflow_schedule_runs"("workspace_id", "status", "created_at" DESC);
CREATE INDEX "idx_workflow_schedule_runs_schedule"
  ON "workflow_schedule_runs"("schedule_id", "created_at" DESC);
CREATE INDEX "idx_workflow_schedule_runs_recovery"
  ON "workflow_schedule_runs"("status", "heartbeat_at");
CREATE INDEX "idx_workflow_schedule_jobs_due"
  ON "workflow_schedule_jobs"("dispatch_status", "next_dispatch_at");
