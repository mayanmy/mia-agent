-- AlterTable
ALTER TABLE "agent_api_keys" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "external_conversations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "external_end_users" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "external_messages" ALTER COLUMN "id" DROP DEFAULT;
