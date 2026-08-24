import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

/**
 * 为 MCP SDK 提供受控 fetch。每一次 DNS 解析和重定向都会重新检查目标，
 * 防止公开地址通过 DNS rebinding 或 30x 把带凭据的请求导向内网。
 */
export function createMcpSafeFetch(allowPrivateNetwork: boolean): typeof globalThis.fetch {
  return async (input, init) => {
    let request = new Request(input, { ...init, redirect: "manual" });

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertMcpUrlAllowed(new URL(request.url), allowPrivateNetwork);
      const replay = request.clone();
      const response = await fetch(request);

      if (![301, 302, 303, 307, 308].includes(response.status)) return response;

      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new Error("MCP redirect limit exceeded");
      }

      const redirectedUrl = new URL(location, request.url);
      if (redirectedUrl.origin !== new URL(request.url).origin) {
        await response.body?.cancel();
        throw new Error("MCP cross-origin redirects are not allowed");
      }
      await response.body?.cancel();

      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && request.method === "POST")
      ) {
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        headers.delete("content-type");
        request = new Request(redirectedUrl, {
          method: "GET",
          headers,
          signal: request.signal,
          redirect: "manual"
        });
      } else {
        request = new Request(redirectedUrl, replay);
      }
    }

    throw new Error("MCP redirect limit exceeded");
  };
}

/** 公网 Server 强制 HTTPS；HTTP 仅供管理员显式放行的本地或私网服务。 */
export async function assertMcpUrlAllowed(
  url: URL,
  allowPrivateNetwork: boolean
): Promise<void> {
  if (url.protocol !== "https:" && !(allowPrivateNetwork && url.protocol === "http:")) {
    throw new Error("MCP endpoint must use HTTPS unless private network access is enabled");
  }
  if (url.username || url.password) throw new Error("MCP endpoint credentials are not allowed");

  const hostname = url.hostname.toLowerCase();
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) throw new Error("MCP endpoint hostname cannot be resolved");
  if (!allowPrivateNetwork && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("MCP endpoint resolves to a private address");
  }
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}
