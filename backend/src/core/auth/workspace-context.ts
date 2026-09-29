import { AsyncLocalStorage } from "node:async_hooks";

import { HttpStatus } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";

import { AppError, ErrorCodes } from "../errors";

type WorkspaceContextStore = {
  workspaceId: string;
  actor?: WorkspaceActor;
};

/** 已通过 JWT 与 WorkspaceGuard 双重校验的空间内操作主体。 */
export type WorkspaceActor = {
  userId: string;
  role: WorkspaceRole;
};

const workspaceContext = new AsyncLocalStorage<WorkspaceContextStore>();

/**
 * Guard 在鉴权通过后写入当前异步请求链，业务层据此统一补充 workspace_id。
 * 这里不接收未经校验的 Header，避免调用方绕过成员校验伪造空间上下文。
 */
export function enterWorkspaceContext(workspaceId: string, actor?: WorkspaceActor): void {
  workspaceContext.enterWith({ workspaceId, actor });
}

/**
 * 在指定项目空间上下文中执行完整异步链。
 *
 * Nest Guard 返回 Promise 后会切换到预先创建的 RxJS 订阅链，Guard 内直接 enterWith 的上下文
 * 可能随之丢失；HTTP 拦截器应通过本函数包裹订阅过程，确保 Controller、Service 和异步回调
 * 始终读取到同一个已验证空间。
 */
export function runInWorkspaceContext<T>(
  workspaceId: string,
  actor: WorkspaceActor | undefined,
  callback: () => T
): T {
  return workspaceContext.run({ workspaceId, actor }, callback);
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

/** 资源写操作读取可信用户与空间角色，禁止从请求 Body 接收创建者或管理角色。 */
export function requireWorkspaceActor(): WorkspaceActor {
  const actor = workspaceContext.getStore()?.actor;
  if (!actor) {
    throw new AppError(
      ErrorCodes.workspace.required,
      "缺少已验证的项目空间操作主体",
      HttpStatus.BAD_REQUEST
    );
  }
  return actor;
}
