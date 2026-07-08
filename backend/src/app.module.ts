import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AgentsModule } from "./modules/agents/agents.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ChatModule } from "./modules/chat/chat.module";
import { HealthModule } from "./modules/health/health.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { LogsModule } from "./modules/logs/logs.module";
import { ModelProvidersModule } from "./modules/model-providers/model-providers.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { RetrievalModule } from "./modules/retrieval/retrieval.module";
import { ToolsModule } from "./modules/tools/tools.module";
import { UsersModule } from "./modules/users/users.module";
import { JwtAuthGuard } from "./core/auth/jwt-auth.guard";
import { RolesGuard } from "./core/auth/roles.guard";

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    HealthModule,
    ModelProvidersModule,
    AgentsModule,
    ChatModule,
    ToolsModule,
    LogsModule,
    KnowledgeModule,
    RetrievalModule
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
    }
  ]
})
export class AppModule {}
