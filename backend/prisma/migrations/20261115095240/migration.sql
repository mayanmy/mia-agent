-- DropForeignKey
ALTER TABLE "chat_message_attachments" DROP CONSTRAINT "chat_message_attachments_file_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_message_attachments" DROP CONSTRAINT "chat_message_attachments_message_id_fkey";

-- DropForeignKey
ALTER TABLE "external_message_attachments" DROP CONSTRAINT "external_message_attachments_file_id_fkey";

-- DropForeignKey
ALTER TABLE "external_message_attachments" DROP CONSTRAINT "external_message_attachments_message_id_fkey";

-- AlterTable
ALTER TABLE "agent_releases" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "agent_versions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "evaluation_case_results" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "evaluation_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_schedule_jobs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_schedule_runs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workflow_schedules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;
