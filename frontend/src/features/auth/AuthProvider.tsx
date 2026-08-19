import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getCurrentUser, logout, refreshLogin } from "./auth.api";
import {
  configureAuthSession,
  ensureFreshAccessToken,
  getAccessTokenExpiresAt,
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
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<number | null>(null);

  /** 将登录或刷新接口返回的短期 Token、用户资料和到期时间同步到内存状态。 */
  const completeLogin = useCallback((response: AuthResponse) => {
    setAccessToken(response.accessToken, response.expiresInSeconds);
    setAccessTokenExpiresAt(getAccessTokenExpiresAt());
    setCurrentUser(response.user);
    setStatus("authenticated");
  }, []);

  /** 清理内存认证状态；Cookie 清理由对应后端接口负责。 */
  const clearAuthentication = useCallback(() => {
    setAccessToken(null);
    setAccessTokenExpiresAt(null);
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
      // /auth/me 仍受 JWT Guard 保护，必须先暂存本次刷新得到的 Access Token。
      setAccessToken(response.accessToken, response.expiresInSeconds);
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

  /**
   * 在 Access Token 到期前一分钟主动刷新。
   *
   * 刷新成功会通过 completeLogin 更新 expiresAt，从而重新安排下一个定时器；失败则清空
   * 内存登录态。定时器只负责续期，不保存任何 Token，浏览器刷新后仍由 HttpOnly Cookie
   * 恢复会话。
   */
  useEffect(() => {
    if (status !== "authenticated" || !accessTokenExpiresAt) {
      return;
    }

    const refreshAheadMs = 60_000;
    const delay = Math.max(0, accessTokenExpiresAt - Date.now() - refreshAheadMs);
    const timer = window.setTimeout(() => {
      // 定时续期必须走统一入口，才能同时复用页内单飞和跨标签页刷新锁。
      void refreshAccessToken();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [accessTokenExpiresAt, status]);

  /**
   * 页面从后台恢复时检查令牌剩余时间。
   *
   * 浏览器会节流后台 tab 的 timer，因此不能只依赖上面的定时器；重新聚焦时以 60 秒为
   * 安全窗口主动续期，避免用户静置后首次点击直接触发 401。
   */
  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    const refreshWhenNeeded = () => {
      if (document.visibilityState === "visible") {
        void ensureFreshAccessToken();
      }
    };

    window.addEventListener("focus", refreshWhenNeeded);
    document.addEventListener("visibilitychange", refreshWhenNeeded);

    return () => {
      window.removeEventListener("focus", refreshWhenNeeded);
      document.removeEventListener("visibilitychange", refreshWhenNeeded);
    };
  }, [status]);

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
