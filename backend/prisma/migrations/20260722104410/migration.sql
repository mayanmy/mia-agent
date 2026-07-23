-- AlterTable
ALTER TABLE "agent_run_steps" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "agent_runs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;
