import * as assert from "node:assert/strict";

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, Observable } from "rxjs";

import { WorkspaceContextInterceptor } from "./workspace-context.interceptor";
import { requireWorkspaceId } from "./workspace-context";

const firstWorkspaceId = "00000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";

function createExecutionContext(workspaceId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ currentWorkspace: { id: workspaceId } })
    })
  } as ExecutionContext;
}

function createAsyncHandler(delay: number): CallHandler {
  return {
    handle: () =>
      new Observable<string>((subscriber) => {
        setTimeout(() => {
          subscriber.next(requireWorkspaceId());
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
          interceptor.intercept(createExecutionContext(firstWorkspaceId), createAsyncHandler(5))
        ),
        firstValueFrom(
          interceptor.intercept(createExecutionContext(secondWorkspaceId), createAsyncHandler(0))
        )
      ]);

      assert.equal(firstResult, firstWorkspaceId);
      assert.equal(secondResult, secondWorkspaceId);
    }
  }
];
