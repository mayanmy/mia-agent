CREATE TYPE "evaluation_job_dispatch_status" AS ENUM ('PENDING', 'DISPATCHED', 'COMPLETED', 'DEAD');

CREATE TABLE "evaluation_jobs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "dispatch_status" "evaluation_job_dispatch_status" NOT NULL DEFAULT 'PENDING',
    "dispatch_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_dispatch_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" TEXT,
    "dispatched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "evaluation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_evaluation_jobs_run_id" ON "evaluation_jobs"("run_id");
CREATE INDEX "idx_evaluation_jobs_dispatch_due" ON "evaluation_jobs"("dispatch_status", "next_dispatch_at");
ALTER TABLE "evaluation_jobs" ADD CONSTRAINT "evaluation_jobs_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 升级时把既有非终态运行补入 outbox，避免切换 Worker 后遗留任务永久停滞。
INSERT INTO "evaluation_jobs" ("id", "run_id", "updated_at")
SELECT gen_random_uuid(), "id", CURRENT_TIMESTAMP
FROM "evaluation_runs"
WHERE "status" IN ('PENDING', 'RUNNING')
ON CONFLICT ("run_id") DO NOTHING;
