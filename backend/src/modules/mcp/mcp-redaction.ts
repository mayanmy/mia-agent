import type { ToolJsonValue } from "../tools/dto/tool.dto";

const REDACTED = "[REDACTED]";
const DEFAULT_SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "passcode",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "clientsecret",
  "apikey",
  "authorization",
  "cookie",
  "sessionid",
  "credential",
  "privatekey"
]);

/**
 * MCP 的参数、结果和远端错误均是不可信数据。该工具只生成可展示、可持久化的副本，
 * 绝不修改真正发送给远端 Server 的输入对象。
 */
export class McpRedactor {
  redactJson<T extends ToolJsonValue>(value: T, configuredPaths: string[] = []): T {
    const cloned = this.redactSensitiveKeys(value);
    for (const path of configuredPaths) {
      this.redactPath(cloned, this.pathSegments(path));
    }
    return cloned as T;
  }

  redactText(value: string, knownSecrets: string[] = []): string {
    let safe = value;
    for (const secret of knownSecrets.filter((item) => item.length >= 4)) {
      safe = safe.split(secret).join(REDACTED);
    }
    return safe
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, `Bearer ${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED)
      .replace(
        /([?&](?:access_token|refresh_token|token|api_key|apikey|secret|password)=)[^&#\s]+/giu,
        `$1${REDACTED}`
      )
      .replace(
        /((?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|authorization|password|passwd|secret)\s*[:=]\s*["']?)[^\s,"'&}]+/giu,
        `$1${REDACTED}`
      );
  }

  normalizePaths(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const paths = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
    if (paths.length > 50) throw new Error("敏感字段路径不能超过 50 个");
    for (const path of paths) {
      const segments = this.pathSegments(path);
      if (
        path.length > 256 ||
        segments.length === 0 ||
        segments.length > 20 ||
        segments.some((segment) =>
          ["__proto__", "prototype", "constructor"].includes(segment.toLowerCase())
        )
      ) {
        throw new Error(`敏感字段路径不合法：${path.slice(0, 80)}`);
      }
    }
    return paths;
  }

  private redactSensitiveKeys(value: ToolJsonValue): ToolJsonValue {
    if (Array.isArray(value)) return value.map((item) => this.redactSensitiveKeys(item));
    if (typeof value === "string") return this.redactText(value);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        DEFAULT_SENSITIVE_KEYS.has(key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase())
          ? REDACTED
          : this.redactSensitiveKeys(item)
      ])
    );
  }

  /** 路径同时接受 JSON Pointer（/customer/mobile）和点路径（customer.mobile、items.*.token）。 */
  private pathSegments(path: string): string[] {
    if (path.startsWith("/")) {
      return path
        .slice(1)
        .split("/")
        .filter(Boolean)
        .map((item) => item.replace(/~1/gu, "/").replace(/~0/gu, "~"));
    }
    return path
      .split(".")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private redactPath(value: ToolJsonValue, segments: string[]): void {
    if (segments.length === 0 || !value || typeof value !== "object") return;
    const [segment, ...rest] = segments;
    if (["__proto__", "prototype", "constructor"].includes(segment.toLowerCase())) return;
    if (Array.isArray(value)) {
      if (segment === "*") {
        for (const item of value) this.redactPath(item, rest);
      } else if (/^\d+$/u.test(segment)) {
        const index = Number(segment);
        if (rest.length === 0 && index < value.length) value[index] = REDACTED;
        else if (value[index] !== undefined) this.redactPath(value[index], rest);
      }
      return;
    }
    if (segment === "*") {
      for (const key of Object.keys(value)) {
        if (rest.length === 0) value[key] = REDACTED;
        else this.redactPath(value[key], rest);
      }
      return;
    }
    if (!(segment in value)) return;
    if (rest.length === 0) value[segment] = REDACTED;
    else this.redactPath(value[segment], rest);
  }
}
