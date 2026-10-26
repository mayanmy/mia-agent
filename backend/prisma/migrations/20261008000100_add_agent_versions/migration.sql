CREATE TYPE "agent_release_action" AS ENUM ('PUBLISH', 'ROLLBACK', 'UNPUBLISH');
CREATE TYPE "agent_runtime_mode" AS ENUM ('DRAFT_PREVIEW', 'VERSION_TEST', 'PUBLISHED', 'LEGACY');

ALTER TABLE "agents"
  ADD COLUMN "draft_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "release_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "published_version_id" UUID;

CREATE TABLE "agent_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "source_draft_revision" INTEGER NOT NULL,
  "config_snapshot" JSONB NOT NULL,
  "config_hash" TEXT NOT NULL,
  "change_summary" TEXT NOT NULL DEFAULT '',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "agent_releases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action" "agent_release_action" NOT NULL,
  "from_version_id" UUID,
  "target_version_id" UUID,
  "evaluation_run_id" UUID,
  "reason" TEXT NOT NULL DEFAULT '',
  "expected_draft_revision" INTEGER,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_releases_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_releases_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_releases_target_version_id_fkey" FOREIGN KEY ("target_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_releases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_agent_versions_agent_version" ON "agent_versions"("agent_id", "version");
CREATE INDEX "idx_agent_versions_agent_created_at" ON "agent_versions"("agent_id", "created_at" DESC);
CREATE INDEX "idx_agent_versions_workspace_hash" ON "agent_versions"("workspace_id", "config_hash");
CREATE UNIQUE INDEX "uq_agent_releases_agent_sequence" ON "agent_releases"("agent_id", "sequence");
CREATE INDEX "idx_agent_releases_agent_created_at" ON "agent_releases"("agent_id", "created_at" DESC);
CREATE INDEX "idx_agent_releases_target_created_at" ON "agent_releases"("target_version_id", "created_at" DESC);
CREATE UNIQUE INDEX "uq_agents_published_version_id" ON "agents"("published_version_id");
CREATE INDEX "idx_agents_published_version_id" ON "agents"("published_version_id");

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_runs"
  ADD COLUMN "agent_version_id" UUID,
  ADD COLUMN "config_hash" TEXT,
  ADD COLUMN "runtime_mode" "agent_runtime_mode";
CREATE INDEX "idx_agent_runs_version_created_at" ON "agent_runs"("agent_version_id", "created_at" DESC);
ALTER TABLE "agent_runs"
  ADD CONSTRAINT "agent_runs_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evaluation_runs" ADD COLUMN "agent_version_id" UUID;
CREATE INDEX "idx_evaluation_runs_agent_version_created" ON "evaluation_runs"("agent_version_id", "created_at" DESC);
ALTER TABLE "evaluation_runs"
  ADD CONSTRAINT "evaluation_runs_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
