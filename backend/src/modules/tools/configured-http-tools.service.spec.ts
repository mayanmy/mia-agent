import * as assert from "node:assert/strict";

import { WorkspaceRole } from "@prisma/client";

import { runInWorkspaceContext } from "../../core/auth/workspace-context";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import { ToolsController } from "./tools.controller";

export const tests = [
  {
    name: "ToolsController allows every workspace role to manage owned HTTP tools",
    run: () => {
      assert.deepEqual(
        Reflect.getMetadata("mia:workspace-roles", ToolsController.prototype.createHttpTool),
        ["OWNER", "MANAGER", "MEMBER"]
      );
    }
  },
  {
    name: "ConfiguredHttpToolsService rejects a MEMBER reading another creator's tool",
    run: async () => {
      const service = new ConfiguredHttpToolsService({
        httpTool: {
          findFirst: async () => ({
            id: "tool-id",
            createdByUserId: "other-user",
            createdBy: { id: "other-user", displayName: "Other" },
            secret: null
          })
        }
      } as never);

      await assert.rejects(
        () =>
          runInWorkspaceContext(
            "00000000-0000-4000-8000-000000000001",
            { userId: "member-user", role: WorkspaceRole.MEMBER },
            () => service.getHttpTool("tool-id")
          ),
        /只能管理自己创建的 HTTP 工具/u
      );
    }
  },
  {
    name: "ConfiguredHttpToolsService validates conservative replay and idempotency metadata",
    run: () => {
      const service = new ConfiguredHttpToolsService({} as never);
      const validateCreate = (
        service as unknown as {
          validateCreate: (payload: Record<string, unknown>) => {
            replayMetadata: Record<string, unknown>;
          };
        }
      ).validateCreate.bind(service);
      const base = {
        name: "工单工具",
        slug: "ticket_tool",
        method: "POST",
        baseUrl: "https://example.com",
        path: "/tickets"
      };

      assert.deepEqual(validateCreate({ ...base, method: "GET" }).replayMetadata, {
        sideEffectLevel: "READ",
        replayPolicy: "REEXECUTE"
      });
      assert.deepEqual(validateCreate(base).replayMetadata, {
        sideEffectLevel: "UNKNOWN",
        replayPolicy: "FORBIDDEN"
      });
      assert.deepEqual(
        validateCreate({
          ...base,
          replayMetadata: {
            sideEffectLevel: "IDEMPOTENT_WRITE",
            replayPolicy: "REEXECUTE",
            idempotency: {
              supported: true,
              transport: "HEADER",
              fieldName: "Idempotency-Key"
            }
          }
        }).replayMetadata,
        {
          sideEffectLevel: "IDEMPOTENT_WRITE",
          replayPolicy: "REEXECUTE",
          idempotency: {
            supported: true,
            transport: "HEADER",
            fieldName: "Idempotency-Key",
            resultLookupSupported: false
          }
        }
      );
      assert.throws(
        () =>
          validateCreate({
            ...base,
            replayMetadata: { sideEffectLevel: "UNKNOWN", replayPolicy: "REEXECUTE" }
          }),
        /不能放宽/u
      );
    }
  }
];
