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
