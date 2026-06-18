-- AlterTable
ALTER TABLE "knowledge_bases" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_chunks" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_documents" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "knowledge_embeddings" ALTER COLUMN "id" DROP DEFAULT;
