CREATE TABLE "agent_skills" (
  "id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "skill_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_agent_skills_agent_skill" ON "agent_skills"("agent_id", "skill_id");
CREATE UNIQUE INDEX "uq_agent_skills_agent_position" ON "agent_skills"("agent_id", "position");
CREATE INDEX "idx_agent_skills_skill_id" ON "agent_skills"("skill_id");

ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
