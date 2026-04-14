CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system_prompt text NOT NULL,
  model_config_id uuid NOT NULL REFERENCES model_configs(id),
  temperature numeric(3,2) NOT NULL DEFAULT 0.70,
  max_tokens integer,
  timeout_seconds integer NOT NULL DEFAULT 120,
  history_turns integer NOT NULL DEFAULT 6,
  generation_params jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_agents_created_at
ON agents (created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_agents_model_config_id
ON agents (model_config_id);

CREATE INDEX idx_agents_enabled_created_at
ON agents (enabled, created_at DESC)
WHERE deleted_at IS NULL;
