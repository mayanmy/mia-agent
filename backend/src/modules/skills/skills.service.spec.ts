import * as assert from "node:assert/strict";

import { SkillsService } from "./skills.service";

export const tests = [
  {
    name: "SkillsService creates imported drafts disabled with an immutable source snapshot",
    run: async () => {
      let created: Record<string, unknown> | undefined;
      const prisma = {
        skill: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created = data;
            const now = new Date("2026-08-11T00:00:00.000Z");
            return {
              ...data,
              revision: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null
            };
          }
        }
      };
      const service = new SkillsService(prisma as never);

      const result = await service.createImportedDraft(
        {
          name: "合同审查",
          instructions: "检查付款和违约条款。",
          sourceType: "mcp_prompt",
          sourceRef: { serverId: "server-1", promptName: "review_contract" }
        },
        "admin-1"
      );

      assert.equal(created?.enabled, false);
      assert.equal(created?.sourceType, "mcp_prompt");
      assert.match(String(created?.sourceHash), /^[a-f0-9]{64}$/);
      assert.equal(result.enabled, false);
    }
  }
];
