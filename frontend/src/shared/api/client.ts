import {
  ensureFreshAccessToken,
  getAccessToken,
  notifyUnauthorized,
  refreshAccessToken
} from "../../features/auth/auth-session";

export type Result<T> = {
  code: number;
  message: string;
  data: T;
};

export type PageResult<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, init);
  const result = (await response.json()) as Result<T>;

  if (!response.ok || result.code !== 200) {
    throw new Error(result.message || "请求失败");
  }

  return result.data;
}

/**
 * 发起带 Access Token 的请求，并在首次 401 时单飞刷新后重试一次。
 *
 * 只重试一次能避免 Refresh Cookie 已失效时的无限循环；FormData、JSON 和 SSE 调用都可
 * 复用此函数，保证认证 Header 与跨域 Cookie 行为一致。
 */
export async function fetchWithAuth(
  path: string,
  init?: RequestInit,
  retried = false
): Promise<Response> {
  // fetch 流式 SSE 同样复用此函数，因此在发起请求前预留有效期，避免长连接刚建立就过期。
  await ensureFreshAccessToken();
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      ...init?.headers
    }
  });

  if (response.status !== 401 || retried) {
    return response;
  }

  const token = await refreshAccessToken();

  if (!token) {
    notifyUnauthorized();
    return response;
  }

  return fetchWithAuth(path, init, true);
}
