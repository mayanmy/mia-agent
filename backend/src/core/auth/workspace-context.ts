import { AsyncLocalStorage } from "node:async_hooks";

import { HttpStatus } from "@nestjs/common";

import { AppError, ErrorCodes } from "../errors";

type WorkspaceContextStore = {
  workspaceId: string;
};

const workspaceContext = new AsyncLocalStorage<WorkspaceContextStore>();

/**
 * Guard 在鉴权通过后写入当前异步请求链，业务层据此统一补充 workspace_id。
 * 这里不接收未经校验的 Header，避免调用方绕过成员校验伪造空间上下文。
 */
export function enterWorkspaceContext(workspaceId: string): void {
  workspaceContext.enterWith({ workspaceId });
}

/**
 * 在指定项目空间上下文中执行完整异步链。
 *
 * Nest Guard 返回 Promise 后会切换到预先创建的 RxJS 订阅链，Guard 内直接 enterWith 的上下文
 * 可能随之丢失；HTTP 拦截器应通过本函数包裹订阅过程，确保 Controller、Service 和异步回调
 * 始终读取到同一个已验证空间。
 */
export function runInWorkspaceContext<T>(workspaceId: string, callback: () => T): T {
  return workspaceContext.run({ workspaceId }, callback);
}

/** 获取已经由 WorkspaceGuard 验证过的项目空间 ID。 */
export function requireWorkspaceId(): string {
  const workspaceId = workspaceContext.getStore()?.workspaceId;
  if (!workspaceId) {
    throw new AppError(
      ErrorCodes.workspace.required,
      "缺少已验证的项目空间上下文",
      HttpStatus.BAD_REQUEST
    );
  }
  return workspaceId;
}

/** 公开访问和后台任务可用它判断当前调用是否来自工作台请求。 */
export function getWorkspaceId(): string | null {
  return workspaceContext.getStore()?.workspaceId ?? null;
}
