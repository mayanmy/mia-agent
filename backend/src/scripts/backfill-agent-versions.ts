import { NestFactory } from "@nestjs/core";
import { WorkspaceRole } from "@prisma/client";

import { AppModule } from "../app.module";
import { runInWorkspaceContext } from "../core/auth/workspace-context";
import { AgentsService } from "../modules/agents/agents.service";
import { PrismaService } from "../modules/prisma/prisma.service";

/** 为升级前已发布 Agent 创建首个不可变版本；逐 Agent 事务且可安全重跑。 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const prisma = app.get(PrismaService);
  const agents = app.get(AgentsService);
  const rows = await prisma.agent.findMany({
    where: { published: true, publishedVersionId: null, deletedAt: null },
    select: { id: true, workspaceId: true, createdByUserId: true },
    orderBy: { createdAt: "asc" }
  });
  let succeeded = 0;
  const failed: string[] = [];

  for (const row of rows) {
    try {
      await runInWorkspaceContext(
        row.workspaceId,
        { userId: row.createdByUserId, role: WorkspaceRole.OWNER },
        () => agents.publishAgent(row.id)
      );
      succeeded += 1;
    } catch {
      failed.push(row.id);
    }
  }

  console.log(
    JSON.stringify({
      scanned: rows.length,
      succeeded,
      failed: failed.length,
      failedAgentIds: failed
    })
  );
  await app.close();
  if (failed.length > 0) process.exitCode = 1;
}

void main();
