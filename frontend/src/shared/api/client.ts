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

/**
 * 合并同一时刻发起的相同 GET 请求。
 *
 * React StrictMode 仅在开发环境会执行一次额外的挂载检查。页面首屏的 useEffect 因此可能
 * 在前一个请求尚未结束时再次执行；这里复用进行中的 Promise，既保留 StrictMode 暴露副作用
 * 问题的能力，又避免列表接口被重复请求。请求结束后立即移除，不充当数据缓存，手动刷新仍会
 * 发起新的网络请求。
 */
const inFlightGetRequests = new Map<string, Promise<unknown>>();

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  // 携带 AbortSignal 的读取请求不能安全复用：任一调用方取消时不应影响其他调用方。
  if (method === "GET" && !init?.signal) {
    const activeRequest = inFlightGetRequests.get(path);

    if (activeRequest) {
      return activeRequest as Promise<T>;
    }

    const requestPromise = performRequest<T>(path, init).finally(() => {
      inFlightGetRequests.delete(path);
    });
    inFlightGetRequests.set(path, requestPromise);
    return requestPromise;
  }

  return performRequest<T>(path, init);
}

/**
 * 执行一次真实的 HTTP 请求并解析 Mia 标准响应。
 *
 * 该函数与请求去重解耦，保证 POST、PUT、DELETE 等有副作用的请求永远不会被合并。
 */
async function performRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
