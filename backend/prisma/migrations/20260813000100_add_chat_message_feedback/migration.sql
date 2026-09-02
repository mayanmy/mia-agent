CREATE TYPE "chat_message_feedback_rating" AS ENUM ('UP', 'DOWN');

CREATE TABLE "chat_message_feedbacks" (
  "id" UUID NOT NULL,
  "message_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "rating" "chat_message_feedback_rating" NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "chat_message_feedbacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_message_feedbacks_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_session_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chat_message_feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_chat_message_feedback_message_user" ON "chat_message_feedbacks"("message_id", "user_id");
CREATE INDEX "idx_chat_message_feedback_rating_created_at" ON "chat_message_feedbacks"("rating", "created_at" DESC);
