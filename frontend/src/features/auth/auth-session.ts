type RefreshHandler = () => Promise<string | null>;
type UnauthorizedHandler = () => void;

let accessToken: string | null = null;
let refreshHandler: RefreshHandler | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let refreshPromise: Promise<string | null> | null = null;

/** 配置由 AuthProvider 提供的刷新和失效回调，避免共享 API 层依赖 React。 */
export function configureAuthSession(options: {
  refresh: RefreshHandler;
  onUnauthorized: UnauthorizedHandler;
}): () => void {
  refreshHandler = options.refresh;
  unauthorizedHandler = options.onUnauthorized;

  return () => {
    if (refreshHandler === options.refresh) {
      refreshHandler = null;
    }

    if (unauthorizedHandler === options.onUnauthorized) {
      unauthorizedHandler = null;
    }
  };
}

/** 设置只驻留内存的短期 Access Token，禁止调用方写入浏览器持久化存储。 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** 读取当前内存 Token，供 SSE 等需要手动构造 Header 的调用使用。 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * 刷新 Access Token，并把并发 401 合并为单一请求。
 *
 * Refresh Token 每次成功刷新都会轮换，因此多个请求分别刷新会互相使旧 Cookie 失效；
 * 单飞 Promise 保证它们复用同一次刷新结果。
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) {
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshHandler().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

/** 通知 React 登录态已不可恢复，使受保护页面统一跳回登录页。 */
export function notifyUnauthorized(): void {
  accessToken = null;
  unauthorizedHandler?.();
}
