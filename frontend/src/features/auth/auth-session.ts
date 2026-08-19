type RefreshHandler = () => Promise<string | null>;
type UnauthorizedHandler = () => void;

let accessToken: string | null = null;
let accessTokenExpiresAt: number | null = null;
let refreshHandler: RefreshHandler | null = null;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let refreshPromise: Promise<string | null> | null = null;

const AUTH_REFRESH_LOCK_NAME = "mia-auth-refresh";

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

/**
 * 设置只驻留内存的短期 Access Token 及其服务端声明的有效期。
 *
 * 不解析 JWT 自身的 exp，统一使用登录/刷新响应的 expiresInSeconds；这样更换 JWT 格式时
 * 前端续期逻辑不会耦合到 Token Payload，同时仍禁止把长期凭证写入浏览器持久化存储。
 */
export function setAccessToken(token: string | null, expiresInSeconds?: number): void {
  accessToken = token;
  accessTokenExpiresAt =
    token && expiresInSeconds && expiresInSeconds > 0 ? Date.now() + expiresInSeconds * 1000 : null;
}

/** 读取当前内存 Token，供 SSE 等需要手动构造 Header 的调用使用。 */
export function getAccessToken(): string | null {
  return accessToken;
}

/** 返回 Access Token 的本地预计到期时间，供 AuthProvider 安排主动续期。 */
export function getAccessTokenExpiresAt(): number | null {
  return accessTokenExpiresAt;
}

/**
 * 刷新 Access Token，并把并发 401 合并为单一请求。
 *
 * Refresh Token 每次成功刷新都会轮换，因此多个请求分别刷新会互相使旧 Cookie 失效。
 * 当前标签页通过单飞 Promise 复用刷新结果，不同标签页则通过同源 Web Lock 串行刷新；
 * 不支持 Web Locks 的浏览器继续退化为原有的页内单飞逻辑。
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshHandler) {
    return null;
  }

  if (!refreshPromise) {
    refreshPromise = refreshWithCrossTabLock(refreshHandler).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

/**
 * 串行同源标签页的 Refresh Cookie 轮换，避免多个页面同时使用同一个旧 Token。
 * 锁由浏览器在回调结束或页面关闭时自动释放，不在 localStorage 中维护易失效的租约。
 */
async function refreshWithCrossTabLock(handler: RefreshHandler): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return handler();
  }

  return navigator.locks.request(AUTH_REFRESH_LOCK_NAME, () => handler());
}

/**
 * 确保当前请求不会携带即将失效的 Access Token。
 *
 * 普通 API 和 fetch 流式 SSE 共用此入口：令牌剩余时间不足阈值时先走已有的单飞刷新，
 * 避免刚建立长连接就因 Token 到期而被服务端中断。Refresh Cookie 无效时返回 null，
 * 由原有 401 处理和 AuthProvider 统一清理登录态。
 */
export async function ensureFreshAccessToken(minimumValidityMs = 60_000): Promise<string | null> {
  if (
    accessToken &&
    accessTokenExpiresAt !== null &&
    accessTokenExpiresAt - Date.now() > minimumValidityMs
  ) {
    return accessToken;
  }

  return refreshAccessToken();
}

/** 通知 React 登录态已不可恢复，使受保护页面统一跳回登录页。 */
export function notifyUnauthorized(): void {
  setAccessToken(null);
  unauthorizedHandler?.();
}
