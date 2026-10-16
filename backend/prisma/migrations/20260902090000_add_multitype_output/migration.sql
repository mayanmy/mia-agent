CREATE TYPE "stored_file_status" AS ENUM ('READY', 'DELETED');

ALTER TABLE "chat_session_messages" ADD COLUMN "content_parts" JSONB;
ALTER TABLE "external_messages" ADD COLUMN "content_parts" JSONB;

CREATE TABLE "stored_files" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "stored_file_status" NOT NULL DEFAULT 'READY',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");
CREATE INDEX "idx_stored_files_workspace_created" ON "stored_files"("workspace_id", "created_at" DESC);

CREATE TABLE "chat_message_attachments" (
  "message_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("message_id", "file_id"),
  CONSTRAINT "chat_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_session_messages"("id") ON DELETE CASCADE,
  CONSTRAINT "chat_message_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_chat_message_attachments_file" ON "chat_message_attachments"("file_id");

CREATE TABLE "external_message_attachments" (
  "message_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_message_attachments_pkey" PRIMARY KEY ("message_id", "file_id"),
  CONSTRAINT "external_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "external_messages"("id") ON DELETE CASCADE,
  CONSTRAINT "external_message_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_external_message_attachments_file" ON "external_message_attachments"("file_id");
