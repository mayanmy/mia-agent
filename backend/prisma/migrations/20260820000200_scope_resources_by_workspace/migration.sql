-- 所有业务资源先回填到默认项目空间，再收紧为非空外键，保证旧数据平滑升级。
DO $$
DECLARE
  default_workspace_id UUID;
  resource_table TEXT;
  resource_count BIGINT;
  resource_tables TEXT[] := ARRAY[
    'model_providers',
    'model_configs',
    'default_model_settings',
    'agents',
    'workflows',
    'workflow_versions',
    'skills',
    'agent_api_keys',
    'external_end_users',
    'external_conversations',
    'http_tools',
    'tool_secrets',
    'mcp_servers',
    'mcp_server_secrets',
    'mcp_oauth_authorizations',
    'mcp_server_tools',
    'mcp_tool_approvals',
    'mcp_sync_runs',
    'chat_sessions',
    'tool_call_logs',
    'agent_runs',
    'knowledge_bases',
    'knowledge_documents',
    'knowledge_chunks',
    'knowledge_embeddings',
    'knowledge_embeddings_1024',
    'knowledge_embeddings_1536',
    'knowledge_embeddings_3072'
  ];
BEGIN
  SELECT "id"
  INTO default_workspace_id
  FROM "workspaces"
  WHERE "deleted_at" IS NULL
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1;

  FOREACH resource_table IN ARRAY resource_tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "workspace_id" UUID', resource_table);

    IF default_workspace_id IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET "workspace_id" = $1', resource_table)
      USING default_workspace_id;
    END IF;

    -- 空表在没有默认空间时也可以安全收紧；有历史数据却找不到空间则拒绝迁移。
    EXECUTE format('SELECT count(*) FROM %I', resource_table) INTO resource_count;
    IF default_workspace_id IS NULL AND resource_count > 0 THEN
      RAISE EXCEPTION 'cannot scope table % because no workspace exists', resource_table;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN "workspace_id" SET NOT NULL', resource_table);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT',
      resource_table,
      'fk_' || resource_table || '_workspace_id'
    );
    EXECUTE format(
      'CREATE INDEX %I ON %I ("workspace_id")',
      'idx_' || resource_table || '_workspace_id',
      resource_table
    );
  END LOOP;
END $$;

-- 工具和 MCP Server 的可读标识只要求在项目空间内唯一。
DROP INDEX IF EXISTS "uq_http_tools_slug";
DROP INDEX IF EXISTS "uq_mcp_servers_slug";
CREATE UNIQUE INDEX "uq_http_tools_workspace_slug"
  ON "http_tools" ("workspace_id", "slug");
CREATE UNIQUE INDEX "uq_mcp_servers_workspace_slug"
  ON "mcp_servers" ("workspace_id", "slug");
