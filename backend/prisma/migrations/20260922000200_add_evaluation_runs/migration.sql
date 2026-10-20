CREATE TYPE "evaluation_run_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "evaluation_case_result_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

CREATE TABLE "evaluation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "dataset_version_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "baseline_run_id" UUID,
  "status" "evaluation_run_status" NOT NULL DEFAULT 'PENDING',
  "total_cases" INTEGER NOT NULL,
  "completed_cases" INTEGER NOT NULL DEFAULT 0,
  "failed_cases" INTEGER NOT NULL DEFAULT 0,
  "skipped_cases" INTEGER NOT NULL DEFAULT 0,
  "agent_config_snapshot" JSONB NOT NULL,
  "retrieval_config_snapshot" JSONB NOT NULL,
  "model_config_snapshot" JSONB NOT NULL,
  "grader_config_snapshot" JSONB NOT NULL,
  "summary_metrics" JSONB,
  "metrics_version" TEXT NOT NULL DEFAULT 'v1',
  "snapshot_hash" TEXT NOT NULL,
  "cancel_requested_at" TIMESTAMPTZ(6),
  "heartbeat_at" TIMESTAMPTZ(6),
  "error_type" TEXT,
  "error_message" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evaluation_case_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "status" "evaluation_case_result_status" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "actual_answer" TEXT,
  "retrieved_chunks" JSONB,
  "citations" JSONB,
  "retrieval_metrics" JSONB,
  "answer_metrics" JSONB,
  "citation_metrics" JSONB,
  "runtime_metrics" JSONB,
  "grader_details" JSONB,
  "error_type" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_case_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_evaluation_runs_workspace_status_created" ON "evaluation_runs"("workspace_id", "status", "created_at" DESC);
CREATE INDEX "idx_evaluation_runs_version_created" ON "evaluation_runs"("dataset_version_id", "created_at" DESC);
CREATE INDEX "idx_evaluation_runs_agent_created" ON "evaluation_runs"("agent_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_evaluation_case_results_run_case" ON "evaluation_case_results"("run_id", "case_id");
CREATE INDEX "idx_evaluation_case_results_run_status_created" ON "evaluation_case_results"("run_id", "status", "created_at");

ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "evaluation_dataset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_baseline_run_id_fkey" FOREIGN KEY ("baseline_run_id") REFERENCES "evaluation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_case_results" ADD CONSTRAINT "evaluation_case_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_case_results" ADD CONSTRAINT "evaluation_case_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "evaluation_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
