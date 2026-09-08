const LAST_WORKSPACE_KEY = "mia.workspace.activeId";

let activeWorkspaceId: string | null = null;

/** 返回当前请求应携带的项目空间 ID。 */
export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

/** 同步请求层使用的空间，并仅持久化非敏感 ID 作为下次登录的选择偏好。 */
export function setActiveWorkspaceId(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId;
  try {
    if (workspaceId) {
      window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
    } else {
      window.localStorage.removeItem(LAST_WORKSPACE_KEY);
    }
  } catch {
    // 隐私模式可能禁用 Storage，当前页面内状态仍可继续使用。
  }
}

/** 读取上次选择，仅作为候选值，WorkspaceProvider 会用服务端列表重新验证。 */
export function readLastWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}
