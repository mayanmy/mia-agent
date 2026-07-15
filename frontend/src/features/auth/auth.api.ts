import { getAccessToken } from "./auth-session";
import type { AuthResponse, CurrentUser } from "./types";

type ApiResult<T> = { code: number; message: string; data: T };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

/**
 * 调用认证接口并统一解析 Mia 响应。
 *
 * 刷新 Token 必须携带 HttpOnly Cookie，因此认证请求显式使用 credentials: include；
 * 不能走普通 request 封装，避免 401 时递归触发刷新。
 */
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const result = (await response.json()) as ApiResult<T>;

  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || "认证请求失败");
  }

  return result.data;
}

/** 使用邮箱密码创建登录态，Refresh Token 由服务端 Cookie 保存。 */
export function login(email: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

/** 使用浏览器自动携带的 Refresh Cookie 恢复短期 Access Token。 */
export function refreshLogin(): Promise<AuthResponse> {
  return authRequest<AuthResponse>("/api/v1/auth/refresh", { method: "POST" });
}

/** 撤销当前设备 Session；后端保持幂等，前端可放心在清理状态时调用。 */
export function logout(): Promise<null> {
  return authRequest<null>("/api/v1/auth/logout", { method: "POST" });
}

/**
 * 返回已由后端 Guard 验证的当前用户公开资料。
 *
 * 刷新接口刚返回的新 Access Token 尚未写入 React 状态时也需要读取该接口，因此在认证模块
 * 内显式带上当前内存 Token，而不是走会触发刷新重试的通用 HTTP 封装，避免刷新流程递归。
 */
export function getCurrentUser(): Promise<CurrentUser> {
  const token = getAccessToken();
  return authRequest<CurrentUser>("/api/v1/auth/me", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
}

export type InvitationValidation = {
  displayName: string;
  email: string;
  expiresAt: string;
};

/** 公开校验成员激活链接，不需要也不携带工作台 Access Token。 */
export function validateInvitation(token: string): Promise<InvitationValidation> {
  const search = new URLSearchParams({ token });
  return authRequest<InvitationValidation>(
    `/api/v1/auth/invitations/validate?${search.toString()}`
  );
}

/** 接受邀请并设置密码；成功响应与普通登录一致，Refresh Token 仍由 Cookie 保存。 */
export function acceptInvitation(token: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>("/api/v1/auth/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}
