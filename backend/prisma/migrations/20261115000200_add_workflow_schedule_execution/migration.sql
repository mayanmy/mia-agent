-- P3 将定时执行接入统一 AgentRun Trace；只保存跨模块关联 ID，不建立 ORM Relation。
ALTER TYPE "agent_run_source" ADD VALUE 'WORKFLOW_SCHEDULE';

ALTER TABLE "agent_runs"
  ADD COLUMN "workflow_schedule_run_id" UUID;

-- 同一个 ScheduleRun 即使重复投递或回写失败，也只能对应一个 AgentRun。
CREATE UNIQUE INDEX "uq_agent_runs_workflow_schedule_run"
  ON "agent_runs"("workflow_schedule_run_id");
