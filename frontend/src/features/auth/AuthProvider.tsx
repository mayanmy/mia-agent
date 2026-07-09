import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getCurrentUser, logout, refreshLogin } from "./auth.api";
import {
  configureAuthSession,
  notifyUnauthorized,
  refreshAccessToken,
  setAccessToken
} from "./auth-session";
import type { AuthResponse, CurrentUser } from "./types";

type AuthContextValue = {
  status: "loading" | "authenticated" | "anonymous";
  currentUser: CurrentUser | null;
  completeLogin: (response: AuthResponse) => void;
  logoutCurrentDevice: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 在应用根部维护登录态，并负责页面刷新后的 Cookie 恢复。
 *
 * Access Token 只保存在 React 内存；刷新页面时重新调用 /auth/refresh，而不是从 localStorage
 * 读取长期凭证，从而缩小 XSS 可以窃取的认证数据范围。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  /** 将登录或刷新接口返回的短期 Token 和用户资料同步到内存状态。 */
  const completeLogin = useCallback((response: AuthResponse) => {
    setAccessToken(response.accessToken);
    setCurrentUser(response.user);
    setStatus("authenticated");
  }, []);

  /** 清理内存认证状态；Cookie 清理由对应后端接口负责。 */
  const clearAuthentication = useCallback(() => {
    setAccessToken(null);
    setCurrentUser(null);
    setStatus("anonymous");
  }, []);

  /**
   * 从 Refresh Cookie 恢复登录态，并二次读取 /auth/me。
   *
   * 二次读取确保当前展示的角色来自 Guard 的实时用户资料，避免仅信任可能已经过期的
   * 登录响应角色。
   */
  const restoreAuthentication = useCallback(async (): Promise<string | null> => {
    try {
      const response = await refreshLogin();
      const user = await getCurrentUser();
      completeLogin({ ...response, user });
      return response.accessToken;
    } catch {
      clearAuthentication();
      return null;
    }
  }, [clearAuthentication, completeLogin]);

  useEffect(() => {
    const dispose = configureAuthSession({
      refresh: restoreAuthentication,
      onUnauthorized: clearAuthentication
    });
    void refreshAccessToken().then((token) => {
      if (!token) {
        clearAuthentication();
      }
    });

    return dispose;
  }, [clearAuthentication, restoreAuthentication]);

  /** 撤销当前设备 Session，并无论后端结果如何都清除本地可用凭证。 */
  const logoutCurrentDevice = useCallback(async () => {
    try {
      await logout();
    } finally {
      notifyUnauthorized();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, currentUser, completeLogin, logoutCurrentDevice }),
    [completeLogin, currentUser, logoutCurrentDevice, status]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 读取登录态；只能在 AuthProvider 子树内调用，避免页面绕过路由守卫。 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }

  return context;
}
