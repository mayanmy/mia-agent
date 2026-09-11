-- 独立 Workflow 应用没有 Agent 归属，但仍需要复用统一 Run/Step Trace。
ALTER TYPE "agent_run_source" ADD VALUE 'WORKFLOW_APP';

ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_agent_id_fkey";
ALTER TABLE "agent_runs" ALTER COLUMN "agent_id" DROP NOT NULL;
ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
