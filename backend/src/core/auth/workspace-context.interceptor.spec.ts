import * as assert from "node:assert/strict";

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { firstValueFrom, Observable } from "rxjs";

import { WorkspaceContextInterceptor } from "./workspace-context.interceptor";
import { requireWorkspaceActor, requireWorkspaceId } from "./workspace-context";

const firstWorkspaceId = "00000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";

function createExecutionContext(workspaceId: string, userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        currentUser: { id: userId },
        currentWorkspace: { id: workspaceId, role: WorkspaceRole.MEMBER }
      })
    })
  } as ExecutionContext;
}

function createAsyncHandler(delay: number): CallHandler {
  return {
    handle: () =>
      new Observable<string>((subscriber) => {
        setTimeout(() => {
          subscriber.next(`${requireWorkspaceId()}:${requireWorkspaceActor().userId}`);
          subscriber.complete();
        }, delay);
      })
  };
}

export const tests = [
  {
    name: "WorkspaceContextInterceptor preserves and isolates workspace context in async handlers",
    run: async () => {
      const interceptor = new WorkspaceContextInterceptor();
      const [firstResult, secondResult] = await Promise.all([
        firstValueFrom(
          interceptor.intercept(
            createExecutionContext(firstWorkspaceId, "user-1"),
            createAsyncHandler(5)
          )
        ),
        firstValueFrom(
          interceptor.intercept(
            createExecutionContext(secondWorkspaceId, "user-2"),
            createAsyncHandler(0)
          )
        )
      ]);

      assert.equal(firstResult, `${firstWorkspaceId}:user-1`);
      assert.equal(secondResult, `${secondWorkspaceId}:user-2`);
    }
  }
];
