import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = {
  appName: string;
  appVersion: string;
  environment: string;
  apiPrefix: string;
  port: number;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  knowledgeStorageDir: string;
  toolsHttpAllowedHosts: string[];
  toolsHttpAllowLocalhost: boolean;
  authJwtSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlDays: number;
  authCookieSecure: boolean;
};

let envLoaded = false;

function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  for (const filePath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");

    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/gu, "");

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    return;
  }
}

function readPort(): number {
  const port = Number(process.env.PORT ?? 8000);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

function readApiPrefix(): string {
  const apiPrefix = process.env.MIA_API_PREFIX ?? "/api/v1";

  if (!apiPrefix.startsWith("/")) {
    throw new Error("MIA_API_PREFIX must start with /");
  }

  return apiPrefix;
}

function readCorsOrigins(): string[] {
  const value = process.env.MIA_CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173";

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function readToolsHttpAllowedHosts(): string[] {
  const value =
    process.env.TOOLS_HTTP_ALLOWED_HOSTS ?? process.env.MIA_TOOLS_HTTP_ALLOWED_HOSTS ?? "";

  return value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function readBooleanEnv(primaryKey: string, fallbackKey?: string): boolean {
  const value = process.env[primaryKey] ?? (fallbackKey ? process.env[fallbackKey] : undefined) ?? "";

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * 读取认证时长配置，并拒绝无效值。
 *
 * Token 时长配置错误会直接影响所有用户的登录状态，因此服务启动时就失败，
 * 避免把 NaN 或负数静默带入签发逻辑。
 */
function readPositiveIntegerEnv(key: string, defaultValue: number): number {
  const value = Number(process.env[key] ?? defaultValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

/**
 * 读取 JWT 签名密钥。
 *
 * JWT 密钥与模型凭证加密密钥分离，后续轮换登录密钥时不会导致已保存的
 * Provider API Key 无法解密。生产环境禁止继续使用示例值，避免可预测签名。
 */
function readAuthJwtSecret(): string {
  const secret = process.env.MIA_AUTH_JWT_SECRET ?? "";
  const environment = process.env.MIA_ENVIRONMENT ?? "local";

  if (!secret) {
    if (environment === "production") {
      throw new Error("MIA_AUTH_JWT_SECRET must be configured in production");
    }

    return "mia-local-development-jwt-secret-change-me";
  }

  if (environment === "production" && secret === "change-me-to-a-long-random-secret") {
    throw new Error("MIA_AUTH_JWT_SECRET must not use the example value in production");
  }

  return secret;
}

export function getConfig(): AppConfig {
  loadEnvFile();

  return {
    appName: process.env.MIA_APP_NAME ?? "Mia",
    appVersion: process.env.MIA_APP_VERSION ?? "0.1.0",
    environment: process.env.MIA_ENVIRONMENT ?? "local",
    apiPrefix: readApiPrefix(),
    port: readPort(),
    corsOrigins: readCorsOrigins(),
    databaseUrl: process.env.DATABASE_URL,
    knowledgeStorageDir: resolve(
      process.cwd(),
      process.env.MIA_KNOWLEDGE_STORAGE_DIR ?? "storage/knowledge"
    ),
    toolsHttpAllowedHosts: readToolsHttpAllowedHosts(),
    toolsHttpAllowLocalhost: readBooleanEnv(
      "TOOLS_HTTP_ALLOW_LOCALHOST",
      "MIA_TOOLS_HTTP_ALLOW_LOCALHOST"
    ),
    authJwtSecret: readAuthJwtSecret(),
    authAccessTokenTtlSeconds: readPositiveIntegerEnv(
      "MIA_AUTH_ACCESS_TOKEN_TTL_SECONDS",
      15 * 60
    ),
    authRefreshTokenTtlDays: readPositiveIntegerEnv("MIA_AUTH_REFRESH_TOKEN_TTL_DAYS", 30),
    authCookieSecure: readBooleanEnv("MIA_AUTH_COOKIE_SECURE")
  };
}
