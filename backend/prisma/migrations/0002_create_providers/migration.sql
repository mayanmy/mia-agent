CREATE TYPE model_provider_type AS ENUM (
  'openai_compatible',
  'ollama',
  'anthropic',
  'gemini'
);

CREATE TYPE model_config_type AS ENUM (
  'chat',
  'embedding'
);

CREATE TABLE model_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider_type model_provider_type NOT NULL,
  base_url text NOT NULL,
  api_key_encrypted text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES model_providers(id),
  model_name text NOT NULL,
  model_type model_config_type NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  timeout_seconds integer NOT NULL DEFAULT 120,
  max_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX uq_model_providers_name
ON model_providers (name)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_model_configs_provider_model_type
ON model_configs (provider_id, model_name, model_type)
WHERE deleted_at IS NULL;

CREATE INDEX idx_model_providers_created_at
ON model_providers (created_at DESC);

CREATE INDEX idx_model_providers_enabled_created_at
ON model_providers (enabled, created_at DESC);

CREATE INDEX idx_model_configs_provider_id
ON model_configs (provider_id);

CREATE INDEX idx_model_configs_type_enabled
ON model_configs (model_type, enabled);

CREATE INDEX idx_model_configs_created_at
ON model_configs (created_at DESC);
