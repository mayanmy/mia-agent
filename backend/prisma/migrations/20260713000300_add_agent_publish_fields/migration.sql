ALTER TABLE "agents"
ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "published_at" TIMESTAMPTZ(6),
ADD COLUMN "share_token" TEXT;

CREATE UNIQUE INDEX "uq_agents_share_token" ON "agents"("share_token");

CREATE INDEX "idx_agents_published_published_at"
ON "agents"("published", "published_at" DESC);
