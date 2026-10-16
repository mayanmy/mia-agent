import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import { AgentsModule } from "./modules/agents/agents.module";
import { AgentRunsModule } from "./modules/agent_runs/agent-runs.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ExternalAccessModule } from "./modules/external_access/external-access.module";
import { HealthModule } from "./modules/health/health.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { LogsModule } from "./modules/logs/logs.module";
import { ModelProvidersModule } from "./modules/model-providers/model-providers.module";
import { McpModule } from "./modules/mcp/mcp.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RetrievalModule } from "./modules/retrieval/retrieval.module";
import { SkillsModule } from "./modules/skills/skills.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { WorkflowRuntimeModule } from "./modules/workflow_runtime/workflow-runtime.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { StorageModule } from "./modules/storage/storage.module";
import { JwtAuthGuard } from "./core/auth/jwt-auth.guard";
import { RolesGuard } from "./core/auth/roles.guard";
import { WorkspaceGuard, WorkspaceRolesGuard } from "./core/auth/workspace.guard";
import { WorkspaceContextInterceptor } from "./core/auth/workspace-context.interceptor";

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    WorkspacesModule,
    HealthModule,
    ModelProvidersModule,
    McpModule,
    AgentRunsModule,
    WorkflowsModule,
    WorkflowRuntimeModule,
    AgentsModule,
    ChatModule,
    ExternalAccessModule,
    ToolsModule,
    LogsModule,
    KnowledgeModule,
    RetrievalModule,
    SkillsModule,
    StorageModule
  ],
  providers: [
    // 默认拒绝所有内部接口，新增 Controller 时必须显式标记 @Public() 才能匿名访问。
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard
    },
    {
      provide: APP_GUARD,
      useClass: WorkspaceGuard
    },
    {
      provide: APP_GUARD,
      useClass: WorkspaceRolesGuard
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: WorkspaceContextInterceptor
    }
  ]
})
export class AppModule {}
