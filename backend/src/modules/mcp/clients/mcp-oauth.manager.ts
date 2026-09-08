import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { McpAuthType, McpHealthStatus } from "@prisma/client";
import {
  auth,
  OAuthClientProvider,
  OAuthClientMetadata,
  OAuthClientInformationContext,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens
} from "@modelcontextprotocol/client";

import { decryptSecret, encryptSecret } from "../../../core/crypto";
import { getConfig } from "../../../core/config";
import { AppError, ErrorCodes } from "../../../core/errors";
import { PrismaService } from "../../prisma/prisma.service";
import { createMcpSafeFetch } from "../mcp-network-policy";
import { McpRedactor } from "../mcp-redaction";

export type McpOAuthRuntimeConfig = {
  serverId: string;
  endpoint: string;
  scope?: string;
  clientAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  clientId?: string;
  clientSecret?: string;
  allowPrivateNetwork: boolean;
};

type PersistedOAuthState = {
  tokens?: StoredOAuthTokens;
  clientInformation?: StoredOAuthClientInformation;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  resourceUrl?: string;
  authorizationServerUrl?: string;
};

/** OAuth 协议状态由独立 Manager 管理，业务 Service 不接触 Access/Refresh Token。 */
@Injectable()
export class McpOAuthManager {
  private readonly config = getConfig();
  private readonly mutations = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redactor: McpRedactor = new McpRedactor()
  ) {}

  createRuntimeProvider(config: McpOAuthRuntimeConfig): OAuthClientProvider {
    return new DatabaseOAuthProvider(this, config);
  }

  /** 启动标准 Discovery + PKCE 流程，并返回管理员浏览器需要打开的授权地址。 */
  async startAuthorization(
    serverId: string,
    userId: string
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const config = await this.loadRuntimeConfig(serverId);
    const state = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    await this.ensureAuthorization(serverId, userId);
    await this.prisma.mcpOAuthAuthorization.update({
      where: { serverId },
      data: { stateHash: this.hashState(state), stateExpiresAt: expiresAt }
    });

    const provider = new DatabaseOAuthProvider(this, config, state);
    try {
      const result = await auth(provider, {
        serverUrl: config.endpoint,
        scope: config.scope,
        fetchFn: createMcpSafeFetch(config.allowPrivateNetwork),
        forceReauthorization: true
      });
      const authorizationUrl = provider.authorizationUrl;
      if (result !== "REDIRECT" || !authorizationUrl) {
        throw new Error("MCP OAuth Server 未返回授权跳转地址");
      }
      return { authorizationUrl, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await this.clearPendingState(serverId);
      throw new AppError(
        ErrorCodes.mcp.invalidConfiguration,
        this.redactor.redactText(
          error instanceof Error ? error.message : "MCP OAuth 初始化失败",
          [config.clientId, config.clientSecret].filter(
            (value): value is string => typeof value === "string"
          )
        )
      );
    }
  }

  /** 公开回调先一次性消费 state，再用持久化 verifier 兑换 Token，防止回放。 */
  async completeAuthorization(input: {
    state: string;
    code?: string;
    iss?: string;
    error?: string;
  }): Promise<string> {
    if (!input.state) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth 回调缺少 state", 400);
    }
    const stateHash = this.hashState(input.state);
    const authorization = await this.prisma.mcpOAuthAuthorization.findUnique({
      where: { stateHash },
      include: { server: true }
    });
    if (
      !authorization ||
      !authorization.stateExpiresAt ||
      authorization.stateExpiresAt < new Date()
    ) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth state 无效或已过期", 400);
    }
    await this.clearPendingState(authorization.serverId);
    if (input.error || !input.code) {
      await this.markAuthorizationRequired(
        authorization.serverId,
        input.error
          ? this.redactor.redactText(`OAuth 授权失败：${input.error}`)
          : "OAuth 回调缺少 code"
      );
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth 授权未完成", 400);
    }

    const config = await this.loadRuntimeConfig(authorization.serverId);
    const provider = new DatabaseOAuthProvider(this, config);
    try {
      const result = await auth(provider, {
        serverUrl: config.endpoint,
        authorizationCode: input.code,
        iss: input.iss,
        scope: config.scope,
        fetchFn: createMcpSafeFetch(config.allowPrivateNetwork)
      });
      if (result !== "AUTHORIZED") throw new Error("MCP OAuth Token 兑换未完成");
      // Token 已由 Provider 持久化后，再原子更新授权时间与 Server 健康状态。
      await this.prisma.$transaction([
        this.prisma.mcpOAuthAuthorization.update({
          where: { serverId: authorization.serverId },
          data: { authorizedAt: new Date() }
        }),
        this.prisma.mcpServer.update({
          where: { id: authorization.serverId },
          data: {
            healthStatus: McpHealthStatus.UNKNOWN,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        })
      ]);
      return authorization.serverId;
    } catch (error) {
      await this.markAuthorizationRequired(
        authorization.serverId,
        this.redactor.redactText(
          error instanceof Error ? error.message : "OAuth Token 兑换失败",
          [config.clientId, config.clientSecret].filter(
            (value): value is string => typeof value === "string"
          )
        )
      );
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth Token 兑换失败", 400);
    }
  }

  /** 本地撤销立即删除 Token；远端撤销端点兼容性作为后续增强，不阻塞本地失效。 */
  async revoke(serverId: string): Promise<void> {
    // OAuth 临时状态、持久 Token 和 Server 状态必须同时清除，避免 UI 与运行时授权判断分叉。
    await this.prisma.$transaction([
      this.prisma.mcpOAuthAuthorization.updateMany({
        where: { serverId },
        data: {
          encryptedState: encryptSecret("{}"),
          stateHash: null,
          stateExpiresAt: null,
          authorizedAt: null
        }
      }),
      this.prisma.mcpServer.update({
        where: { id: serverId },
        data: {
          healthStatus: McpHealthStatus.AUTH_REQUIRED,
          lastErrorCode: "AUTH_REQUIRED",
          lastErrorMessage: "OAuth 授权已撤销"
        }
      })
    ]);
  }

  redirectUrl(): string {
    return new URL(
      `${this.config.apiPrefix}/mcp/servers/oauth/callback`,
      this.config.publicBaseUrl
    ).toString();
  }

  async readState(serverId: string): Promise<PersistedOAuthState> {
    const record = await this.prisma.mcpOAuthAuthorization.findUnique({ where: { serverId } });
    if (!record) return {};
    try {
      return JSON.parse(decryptSecret(record.encryptedState)) as PersistedOAuthState;
    } catch {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth 状态损坏，请重新授权");
    }
  }

  async mutateState(serverId: string, mutate: (state: PersistedOAuthState) => void): Promise<void> {
    const previous = this.mutations.get(serverId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const state = await this.readState(serverId);
      mutate(state);
      await this.prisma.mcpOAuthAuthorization.update({
        where: { serverId },
        data: { encryptedState: encryptSecret(JSON.stringify(state)) }
      });
    });
    const tracked = next.catch(() => undefined);
    this.mutations.set(serverId, tracked);
    await next.finally(() => {
      if (this.mutations.get(serverId) === tracked) this.mutations.delete(serverId);
    });
  }

  private async ensureAuthorization(serverId: string, userId: string): Promise<void> {
    await this.prisma.mcpOAuthAuthorization.upsert({
      where: { serverId },
      create: {
        id: randomUUID(),
        serverId,
        encryptedState: encryptSecret("{}"),
        createdByUserId: userId
      },
      update: {}
    });
  }

  private async loadRuntimeConfig(serverId: string): Promise<McpOAuthRuntimeConfig> {
    const server = await this.prisma.mcpServer.findFirst({
      where: { id: serverId, deletedAt: null, authType: McpAuthType.OAUTH },
      include: { secret: { select: { encryptedValue: true } } }
    });
    if (!server) throw new AppError(ErrorCodes.mcp.notFound, "OAuth MCP Server 不存在", 404);
    const authConfig = this.jsonRecord(server.authConfig);
    const credentials = server.secret
      ? this.parseCredentials(decryptSecret(server.secret.encryptedValue))
      : {};
    return {
      serverId,
      endpoint: server.endpoint,
      scope: typeof authConfig.scope === "string" ? authConfig.scope : undefined,
      clientAuthMethod: this.clientAuthMethod(authConfig.clientAuthMethod),
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      allowPrivateNetwork: server.allowPrivateNetwork
    };
  }

  private async clearPendingState(serverId: string): Promise<void> {
    await this.prisma.mcpOAuthAuthorization.updateMany({
      where: { serverId },
      data: { stateHash: null, stateExpiresAt: null }
    });
  }

  async markAuthorizationRequired(serverId: string, message: string): Promise<void> {
    await this.prisma.mcpServer.update({
      where: { id: serverId },
      data: {
        healthStatus: McpHealthStatus.AUTH_REQUIRED,
        lastErrorCode: "AUTH_REQUIRED",
        lastErrorMessage: this.redactor.redactText(message).slice(0, 2_000)
      }
    });
  }

  private hashState(state: string): string {
    return createHash("sha256").update(state).digest("hex");
  }

  private parseCredentials(value: string): Record<string, string> {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
    } catch {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP OAuth Client 凭据损坏");
    }
  }

  private clientAuthMethod(value: unknown): McpOAuthRuntimeConfig["clientAuthMethod"] {
    if (value === "client_secret_basic" || value === "client_secret_post") return value;
    return "none";
  }

  private jsonRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}

/** SDK Provider 只负责协议回调，所有持久化均回到 Manager 的加密存储。 */
class DatabaseOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: string;

  constructor(
    private readonly manager: McpOAuthManager,
    private readonly config: McpOAuthRuntimeConfig,
    private readonly oauthState?: string
  ) {}

  get redirectUrl(): string {
    return this.manager.redirectUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Mia MCP Client",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: this.config.clientAuthMethod,
      scope: this.config.scope
    };
  }

  async state(): Promise<string> {
    if (!this.oauthState) throw new Error("MCP OAuth state 未初始化");
    return this.oauthState;
  }

  async clientInformation(
    context?: OAuthClientInformationContext
  ): Promise<StoredOAuthClientInformation | undefined> {
    const persisted = await this.manager.readState(this.config.serverId);
    if (persisted.clientInformation) return persisted.clientInformation;
    if (!this.config.clientId) return undefined;
    return {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      token_endpoint_auth_method: this.config.clientAuthMethod,
      issuer: context?.issuer
    };
  }

  async saveClientInformation(value: StoredOAuthClientInformation): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.clientInformation = value;
    });
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> {
    return (await this.manager.readState(this.config.serverId)).tokens;
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.tokens = tokens;
      delete state.codeVerifier;
    });
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url.toString();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.codeVerifier = codeVerifier;
    });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.manager.readState(this.config.serverId)).codeVerifier;
    if (!verifier) throw new Error("MCP OAuth PKCE verifier 不存在或已过期");
    return verifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.discoveryState = discoveryState;
    });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.manager.readState(this.config.serverId)).discoveryState;
  }

  async saveResourceUrl(resourceUrl: string): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.resourceUrl = resourceUrl;
    });
  }

  async resourceUrl(): Promise<string | undefined> {
    return (await this.manager.readState(this.config.serverId)).resourceUrl;
  }

  async saveAuthorizationServerUrl(url: string): Promise<void> {
    await this.manager.mutateState(this.config.serverId, (state) => {
      state.authorizationServerUrl = url;
    });
  }

  async authorizationServerUrl(): Promise<string | undefined> {
    return (await this.manager.readState(this.config.serverId)).authorizationServerUrl;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await this.manager.mutateState(this.config.serverId, (state) => {
      if (scope === "all" || scope === "client") delete state.clientInformation;
      if (scope === "all" || scope === "tokens") delete state.tokens;
      if (scope === "all" || scope === "verifier") delete state.codeVerifier;
      if (scope === "all" || scope === "discovery") delete state.discoveryState;
    });
    if (scope === "all" || scope === "tokens") {
      await this.manager.markAuthorizationRequired(
        this.config.serverId,
        "OAuth Token 已失效，需要重新授权"
      );
    }
  }
}
