import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { clearRequestDedupeCache } from "../../shared/api/client";
import { useAuth } from "../auth/AuthProvider";
import { listWorkspaces } from "./api";
import { readLastWorkspaceId, setActiveWorkspaceId } from "./workspace-session";
import type { WorkspaceListItem } from "./types";

type WorkspaceContextValue = {
  /** 项目空间列表加载状态。 */
  status: "idle" | "loading" | "ready";
  /** 当前账号加入的全部有效项目空间。 */
  workspaces: WorkspaceListItem[];
  /** 当前选中的项目空间。 */
  currentWorkspace: WorkspaceListItem | null;
  /** 切换当前空间并清理跨空间请求缓存。 */
  switchWorkspace: (workspaceId: string) => void;
  /** 刷新列表；创建空间后可指定优先选中的空间。 */
  refreshWorkspaces: (preferredWorkspaceId?: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * 维护当前项目空间，并把服务端验证过的空间 ID 同步给统一请求层。
 *
 * 切换时先清理 GET 去重缓存，再更新请求上下文，防止相同 URL 复用上一个空间的响应。
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus } = useAuth();
  const [status, setStatus] = useState<WorkspaceContextValue["status"]>("idle");
  const [workspaces, setWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceListItem | null>(null);

  const applyWorkspace = useCallback((workspace: WorkspaceListItem | null) => {
    clearRequestDedupeCache();
    setActiveWorkspaceId(workspace?.id ?? null);
    setCurrentWorkspace(workspace);
  }, []);

  const refreshWorkspaces = useCallback(
    async (preferredWorkspaceId?: string) => {
      if (authStatus !== "authenticated") {
        setWorkspaces([]);
        applyWorkspace(null);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      try {
        const list = await listWorkspaces();
        setWorkspaces(list);
        const preferredId = preferredWorkspaceId ?? readLastWorkspaceId();
        applyWorkspace(list.find((workspace) => workspace.id === preferredId) ?? list[0] ?? null);
      } finally {
        setStatus("ready");
      }
    },
    [applyWorkspace, authStatus]
  );

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (workspace) {
        applyWorkspace(workspace);
      }
    },
    [applyWorkspace, workspaces]
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({ status, workspaces, currentWorkspace, switchWorkspace, refreshWorkspaces }),
    [currentWorkspace, refreshWorkspaces, status, switchWorkspace, workspaces]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** 读取项目空间上下文；只能在 WorkspaceProvider 子树内调用。 */
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  }
  return context;
}
