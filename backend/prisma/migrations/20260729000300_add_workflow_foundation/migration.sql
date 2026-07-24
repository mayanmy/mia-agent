-- 现有 Agent 默认继续使用自主循环，避免迁移后改变已发布 Agent 的运行行为。
CREATE TYPE "agent_execution_mode" AS ENUM ('AGENT_LOOP', 'WORKFLOW');
CREATE TYPE "workflow_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "workflow_run_mode" AS ENUM ('DRAFT_TEST', 'PUBLISHED');

ALTER TYPE "agent_run_step_type" ADD VALUE 'WORKFLOW';
ALTER TYPE "agent_run_step_type" ADD VALUE 'CONDITION';
ALTER TYPE "agent_run_step_type" ADD VALUE 'TRANSFORM';

ALTER TABLE "agents"
ADD COLUMN "execution_mode" "agent_execution_mode" NOT NULL DEFAULT 'AGENT_LOOP';

CREATE TABLE "workflows" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "workflow_status" NOT NULL DEFAULT 'DRAFT',
  "draft_graph" JSONB NOT NULL,
  "draft_revision" INTEGER NOT NULL DEFAULT 1,
  "published_version" INTEGER,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_versions" (
  "id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "graph_schema_version" INTEGER NOT NULL,
  "graph" JSONB NOT NULL,
  "compiled_plan" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "published_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_versions_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "agent_workflows" (
  "agent_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_workflows_pkey" PRIMARY KEY ("agent_id"),
  CONSTRAINT "agent_workflows_agent_id_fkey"
    FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "agent_runs"
ADD COLUMN "workflow_id" UUID,
ADD COLUMN "workflow_version_id" UUID,
ADD COLUMN "workflow_run_mode" "workflow_run_mode";

ALTER TABLE "agent_run_steps"
ADD COLUMN "node_id" TEXT,
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "idx_workflows_status_updated_at" ON "workflows"("status", "updated_at" DESC);
CREATE INDEX "idx_workflows_creator_created_at" ON "workflows"("created_by_user_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_workflow_versions_workflow_version" ON "workflow_versions"("workflow_id", "version");
CREATE INDEX "idx_workflow_versions_workflow_created_at" ON "workflow_versions"("workflow_id", "created_at" DESC);
CREATE INDEX "idx_agent_workflows_workflow_version" ON "agent_workflows"("workflow_id", "workflow_version_id");
CREATE INDEX "idx_agent_runs_workflow_version_created_at"
ON "agent_runs"("workflow_id", "workflow_version_id", "created_at" DESC);
