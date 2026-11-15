-- P4 以数据库取消时间为权威状态；Redis 通知只用于加速正在运行的 Worker。
ALTER TABLE "workflow_schedule_runs"
  ADD COLUMN "cancel_requested_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_workflow_schedule_runs_cancel_requested"
  ON "workflow_schedule_runs"("status", "cancel_requested_at")
  WHERE "cancel_requested_at" IS NOT NULL;
