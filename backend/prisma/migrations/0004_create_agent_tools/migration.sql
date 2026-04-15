CREATE TABLE agent_tools (
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool_id)
);

CREATE INDEX idx_agent_tools_tool_id
ON agent_tools (tool_id);
