/*
  Warnings:

  - A unique constraint covering the columns `[workspace_id]` on the table `default_model_settings` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "agent_api_keys" DROP CONSTRAINT "fk_agent_api_keys_workspace_id";

-- DropForeignKey
ALTER TABLE "agent_runs" DROP CONSTRAINT "fk_agent_runs_workspace_id";

-- DropForeignKey
ALTER TABLE "agents" DROP CONSTRAINT "fk_agents_workspace_id";

-- DropForeignKey
ALTER TABLE "chat_sessions" DROP CONSTRAINT "fk_chat_sessions_workspace_id";

-- DropForeignKey
ALTER TABLE "default_model_settings" DROP CONSTRAINT "fk_default_model_settings_workspace_id";

-- DropForeignKey
ALTER TABLE "external_conversations" DROP CONSTRAINT "fk_external_conversations_workspace_id";

-- DropForeignKey
ALTER TABLE "external_end_users" DROP CONSTRAINT "fk_external_end_users_workspace_id";

-- DropForeignKey
ALTER TABLE "http_tools" DROP CONSTRAINT "fk_http_tools_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_bases" DROP CONSTRAINT "fk_knowledge_bases_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "fk_knowledge_chunks_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "fk_knowledge_documents_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_embeddings" DROP CONSTRAINT "fk_knowledge_embeddings_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_embeddings_1024" DROP CONSTRAINT "fk_knowledge_embeddings_1024_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_embeddings_1536" DROP CONSTRAINT "fk_knowledge_embeddings_1536_workspace_id";

-- DropForeignKey
ALTER TABLE "knowledge_embeddings_3072" DROP CONSTRAINT "fk_knowledge_embeddings_3072_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_oauth_authorizations" DROP CONSTRAINT "fk_mcp_oauth_authorizations_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_server_secrets" DROP CONSTRAINT "fk_mcp_server_secrets_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_server_tools" DROP CONSTRAINT "fk_mcp_server_tools_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_servers" DROP CONSTRAINT "fk_mcp_servers_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_sync_runs" DROP CONSTRAINT "fk_mcp_sync_runs_workspace_id";

-- DropForeignKey
ALTER TABLE "mcp_tool_approvals" DROP CONSTRAINT "fk_mcp_tool_approvals_workspace_id";

-- DropForeignKey
ALTER TABLE "model_configs" DROP CONSTRAINT "fk_model_configs_workspace_id";

-- DropForeignKey
ALTER TABLE "model_providers" DROP CONSTRAINT "fk_model_providers_workspace_id";

-- DropForeignKey
ALTER TABLE "skills" DROP CONSTRAINT "fk_skills_workspace_id";

-- DropForeignKey
ALTER TABLE "tool_call_logs" DROP CONSTRAINT "fk_tool_call_logs_workspace_id";

-- DropForeignKey
ALTER TABLE "tool_secrets" DROP CONSTRAINT "fk_tool_secrets_workspace_id";

-- DropForeignKey
ALTER TABLE "workflow_versions" DROP CONSTRAINT "fk_workflow_versions_workspace_id";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "fk_workflows_workspace_id";

-- DropIndex
DROP INDEX "idx_agent_api_keys_workspace_id";

-- DropIndex
DROP INDEX "idx_agent_runs_workspace_id";

-- DropIndex
DROP INDEX "idx_agents_workspace_id";

-- DropIndex
DROP INDEX "idx_chat_sessions_workspace_id";

-- DropIndex
DROP INDEX "idx_default_model_settings_workspace_id";

-- DropIndex
DROP INDEX "idx_external_conversations_workspace_id";

-- DropIndex
DROP INDEX "idx_external_end_users_workspace_id";

-- DropIndex
DROP INDEX "idx_http_tools_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_bases_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_chunks_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_documents_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_embeddings_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_embeddings_1024_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_embeddings_1536_workspace_id";

-- DropIndex
DROP INDEX "idx_knowledge_embeddings_3072_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_oauth_authorizations_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_server_secrets_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_server_tools_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_servers_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_sync_runs_workspace_id";

-- DropIndex
DROP INDEX "idx_mcp_tool_approvals_workspace_id";

-- DropIndex
DROP INDEX "idx_model_configs_workspace_id";

-- DropIndex
DROP INDEX "idx_model_providers_workspace_id";

-- DropIndex
DROP INDEX "idx_skills_workspace_id";

-- DropIndex
DROP INDEX "idx_tool_call_logs_workspace_id";

-- DropIndex
DROP INDEX "idx_tool_secrets_workspace_id";

-- DropIndex
DROP INDEX "idx_workflow_versions_workspace_id";

-- DropIndex
DROP INDEX "idx_workflows_workspace_id";

-- AlterTable
ALTER TABLE "default_model_settings" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "uq_default_model_settings_workspace_id" ON "default_model_settings"("workspace_id");
