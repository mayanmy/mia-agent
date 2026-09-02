ALTER TABLE "mcp_server_tools"
  ADD COLUMN "sensitive_input_paths" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "sensitive_output_paths" JSONB NOT NULL DEFAULT '[]';
