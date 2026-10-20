CREATE TYPE "evaluation_dataset_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "evaluation_dataset_version_status" AS ENUM ('DRAFT', 'FROZEN');
CREATE TYPE "evaluation_case_source_type" AS ENUM ('MANUAL', 'IMPORT', 'ONLINE_FEEDBACK');

CREATE TABLE "evaluation_datasets" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "evaluation_dataset_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_datasets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evaluation_datasets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "evaluation_datasets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "evaluation_dataset_versions" (
  "id" UUID NOT NULL,
  "dataset_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "evaluation_dataset_version_status" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "case_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" UUID NOT NULL,
  "frozen_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_dataset_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evaluation_dataset_versions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "evaluation_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "evaluation_dataset_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "evaluation_cases" (
  "id" UUID NOT NULL,
  "dataset_version_id" UUID NOT NULL,
  "question" TEXT NOT NULL,
  "question_hash" TEXT NOT NULL,
  "expected_answer" TEXT,
  "expected_document_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "expected_chunk_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "answerable" BOOLEAN NOT NULL DEFAULT true,
  "category" TEXT,
  "difficulty" TEXT,
  "source_type" "evaluation_case_source_type" NOT NULL DEFAULT 'MANUAL',
  "source_feedback_id" UUID,
  "metadata" JSONB,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "evaluation_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evaluation_cases_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "evaluation_dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "evaluation_cases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_evaluation_datasets_workspace_name" ON "evaluation_datasets"("workspace_id", "normalized_name");
CREATE INDEX "idx_evaluation_datasets_workspace_status_updated" ON "evaluation_datasets"("workspace_id", "status", "updated_at" DESC);
CREATE UNIQUE INDEX "uq_evaluation_dataset_versions_dataset_version" ON "evaluation_dataset_versions"("dataset_id", "version");
CREATE UNIQUE INDEX "uq_evaluation_dataset_versions_one_draft" ON "evaluation_dataset_versions"("dataset_id") WHERE "status" = 'DRAFT';
CREATE INDEX "idx_evaluation_dataset_versions_dataset_status_created" ON "evaluation_dataset_versions"("dataset_id", "status", "created_at" DESC);
CREATE UNIQUE INDEX "uq_evaluation_cases_version_question_hash" ON "evaluation_cases"("dataset_version_id", "question_hash");
CREATE INDEX "idx_evaluation_cases_version_created" ON "evaluation_cases"("dataset_version_id", "created_at" DESC);
