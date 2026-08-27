CREATE TABLE "skills" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL,
  "usage_conditions" TEXT NOT NULL DEFAULT '',
  "input_guidance" TEXT NOT NULL DEFAULT '',
  "output_guidance" TEXT NOT NULL DEFAULT '',
  "limitations" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "source_type" TEXT NOT NULL DEFAULT 'manual',
  "source_ref" JSONB,
  "source_hash" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_skills_enabled_updated_at" ON "skills"("enabled", "updated_at" DESC);
CREATE INDEX "idx_skills_created_by_user_id" ON "skills"("created_by_user_id");
CREATE INDEX "idx_skills_source_hash" ON "skills"("source_type", "source_hash");
