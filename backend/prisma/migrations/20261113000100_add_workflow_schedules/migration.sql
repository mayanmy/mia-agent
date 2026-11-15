-- Workflow Schedule P1 只落配置表；调度扫描、执行记录与队列 Outbox 在后续阶段引入。
CREATE TYPE "workflow_schedule_status" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "workflow_schedule_misfire_policy" AS ENUM ('SKIP', 'RUN_ONCE', 'CATCH_UP');
CREATE TYPE "workflow_schedule_concurrency_policy" AS ENUM ('QUEUE', 'SKIP', 'ALLOW');

CREATE TABLE "workflow_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "workflow_schedule_status" NOT NULL DEFAULT 'PAUSED',
  "cron_expression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "inputs" JSONB NOT NULL,
  "misfire_policy" "workflow_schedule_misfire_policy" NOT NULL DEFAULT 'RUN_ONCE',
  "concurrency_policy" "workflow_schedule_concurrency_policy" NOT NULL DEFAULT 'QUEUE',
  "max_catch_up_runs" INTEGER NOT NULL DEFAULT 1,
  "timeout_seconds" INTEGER NOT NULL DEFAULT 1800,
  "next_run_at" TIMESTAMPTZ(6),
  "last_scheduled_at" TIMESTAMPTZ(6),
  "last_started_at" TIMESTAMPTZ(6),
  "last_finished_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "workflow_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_schedules_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workflow_schedules_workflow_version_id_fkey"
    FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Prisma 不能表达这些区间约束；数据库兜底阻止绕过 Service 写入不可执行配置。
  CONSTRAINT "workflow_schedules_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "workflow_schedules_max_catch_up_runs_check" CHECK ("max_catch_up_runs" BETWEEN 1 AND 10),
  CONSTRAINT "workflow_schedules_timeout_seconds_check" CHECK ("timeout_seconds" BETWEEN 60 AND 86400)
);

CREATE INDEX "idx_workflow_schedules_due"
  ON "workflow_schedules"("workspace_id", "status", "next_run_at");
CREATE INDEX "idx_workflow_schedules_workflow"
  ON "workflow_schedules"("workflow_id", "status", "updated_at" DESC);
