import { createHash, randomUUID } from "node:crypto";

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  McpApprovalMode,
  McpAuthType,
  McpHealthStatus,
  McpRiskLevel,
  McpSyncStatus,
  McpSyncTrigger,
  Prisma
} from "@prisma/client";

import { decryptSecret, encryptSecret } from "../../core/crypto";
import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import {
  McpConnectionTestResult,
  McpServerCreateDto,
  McpServerDetail,
  McpServerListItem,
  McpServerToolDetail,
  McpServerToolUpdateDto,
  McpServerUpdateDto,
  McpSyncResult,
  McpSyncRunListItem
} from "./dto/mcp-server.dto";
import {
  McpProtocolClientFactory,
  McpClientRuntimeConfig
} from "./clients/mcp-protocol-client.factory";
import { McpProtocolTool } from "./clients/mcp-protocol.client";
import {
  McpRuntimeResolutionError,
  McpRuntimeToolConfig,
  McpRuntimeToolDefinition
} from "./dto/mcp-runtime.dto";

const SERVER_INCLUDE = {
  secret: { select: { id: true } },
  _count: { select: { tools: true } }
} satisfies Prisma.McpServerInclude;

type ServerWithSummary = Prisma.McpServerGetPayload<{ include: typeof SERVER_INCLUDE }>;

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private readonly patrolIntervalMs = 15 * 60 * 1_000;
  private patrolTimer?: NodeJS.Timeout;
  private patrolRunning = false;
  private readonly notificationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientFactory: McpProtocolClientFactory
  ) {}

  onModuleInit(): void {
    this.clientFactory.registerToolsChangedHandler((serverId) =>
      this.scheduleNotificationSync(serverId)
    );
    // 巡检不阻塞应用启动；定时器 unref 后也不会阻止测试或 CLI 正常退出。
    this.patrolTimer = setInterval(() => void this.runHealthPatrol(), this.patrolIntervalMs);
    this.patrolTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.patrolTimer) clearInterval(this.patrolTimer);
    for (const timer of this.notificationTimers.values()) clearTimeout(timer);
    this.notificationTimers.clear();
  }

  async listServers(): Promise<McpServerListItem[]> {
    const servers = await this.prisma.mcpServer.findMany({
      where: { deletedAt: null },
      include: SERVER_INCLUDE,
      orderBy: { createdAt: "desc" }
    });
    const enabledCounts = await this.prisma.mcpServerTool.groupBy({
      by: ["serverId"],
      where: { serverId: { in: servers.map((item) => item.id) }, enabled: true },
      _count: true
    });
    const countByServer = new Map(enabledCounts.map((item) => [item.serverId, item._count]));
    return servers.map((server) => this.toListItem(server, countByServer.get(server.id) ?? 0));
  }

  async getServer(id: string): Promise<McpServerDetail> {
    const server = await this.requireServer(id);
    const enabledToolCount = await this.prisma.mcpServerTool.count({
      where: { serverId: id, enabled: true }
    });
    return this.toDetail(server, enabledToolCount);
  }

  /** 只向统一工具目录暴露已启用、可用且无需人工确认的远程 Tool。 */
  async listRuntimeTools(): Promise<McpRuntimeToolDefinition[]> {
    const tools = await this.prisma.mcpServerTool.findMany({
      where: this.runtimeToolWhere(),
      orderBy: [{ server: { name: "asc" } }, { remoteName: "asc" }]
    });
    return tools.map((tool) => this.toRuntimeDefinition(tool));
  }

  /** 按 Agent 绑定顺序批量返回定义；不可运行的 Tool 会被自然过滤。 */
  async getRuntimeToolDefinitions(runtimeIds: string[]): Promise<McpRuntimeToolDefinition[]> {
    if (runtimeIds.length === 0) return [];
    const tools = await this.prisma.mcpServerTool.findMany({
      where: { ...this.runtimeToolWhere(), runtimeId: { in: runtimeIds } }
    });
    const byId = new Map(tools.map((tool) => [tool.runtimeId, this.toRuntimeDefinition(tool)]));
    return runtimeIds.flatMap((runtimeId) => {
      const tool = byId.get(runtimeId);
      return tool ? [tool] : [];
    });
  }

  /**
   * 执行前重新读取 Server/Tool 状态，不能信任模型生成定义时的旧快照。
   * 这样管理员停用 Server 或 Tool 后，进行中的会话也会立即阻止下一次调用。
   */
  async resolveRuntimeTool(runtimeId: string): Promise<McpRuntimeToolConfig | null> {
    if (!runtimeId.startsWith("mcp_")) return null;
    const tool = await this.prisma.mcpServerTool.findUnique({
      where: { runtimeId },
      include: { server: { include: { secret: { select: { encryptedValue: true } } } } }
    });
    if (!tool) return null;
    if (!tool.server.enabled || tool.server.deletedAt) {
      throw new McpRuntimeResolutionError("mcp_server_disabled", "MCP Server 已停用");
    }
    if (!tool.enabled || tool.unavailableAt) {
      throw new McpRuntimeResolutionError("mcp_tool_unavailable", "MCP Tool 已停用或不可用");
    }
    if (tool.server.healthStatus === McpHealthStatus.AUTH_REQUIRED) {
      throw new McpRuntimeResolutionError("mcp_auth_required", "MCP Server 需要重新鉴权");
    }
    if (
      tool.approvalMode === McpApprovalMode.CONFIRM ||
      (!tool.approvalMode && tool.server.approvalMode === McpApprovalMode.CONFIRM)
    ) {
      throw new McpRuntimeResolutionError("mcp_approval_required", "MCP Tool 需要人工确认");
    }
    if (
      tool.approvalMode === McpApprovalMode.DISABLED ||
      (!tool.approvalMode && tool.server.approvalMode === McpApprovalMode.DISABLED)
    ) {
      throw new McpRuntimeResolutionError("mcp_tool_unavailable", "MCP Tool 已被策略禁用");
    }

    return {
      serverId: tool.serverId,
      toolId: tool.id,
      runtimeId: tool.runtimeId,
      remoteName: tool.remoteName,
      inputSchema: this.jsonRecord(tool.inputSchema),
      schemaHash: tool.schemaHash,
      maxResponseBytes: tool.server.maxResponseBytes,
      maxOutputChars: tool.server.maxOutputChars,
      maxConcurrency: tool.server.maxConcurrency,
      client: {
        serverId: tool.serverId,
        endpoint: tool.server.endpoint,
        authType: tool.server.authType.toLowerCase() as McpClientRuntimeConfig["authType"],
        authConfig: this.jsonRecord(tool.server.authConfig),
        ...this.decodeCredential(
          tool.server.authType,
          tool.server.secret ? decryptSecret(tool.server.secret.encryptedValue) : undefined
        ),
        authCacheKey: `${tool.server.id}:${tool.server.updatedAt.getTime()}`,
        allowPrivateNetwork: tool.server.allowPrivateNetwork,
        connectTimeoutMs: tool.server.connectTimeoutMs,
        toolTimeoutMs: tool.server.toolTimeoutMs
      }
    };
  }

  /** 创建仅持久化配置，不在事务中访问远端；管理员可随后显式测试和同步。 */
  async createServer(payload: McpServerCreateDto, userId: string): Promise<McpServerDetail> {
    const values = this.normalizeCreate(payload);
    const encryptedCredential = this.credentialValue(payload, values.authType as McpAuthType, true);
    try {
      const server = await this.prisma.$transaction(async (tx) => {
        const secret = encryptedCredential
          ? await tx.mcpServerSecret.create({
              data: { encryptedValue: encryptSecret(encryptedCredential), createdByUserId: userId }
            })
          : undefined;
        return tx.mcpServer.create({
          data: { ...values, secretId: secret?.id, createdByUserId: userId },
          include: SERVER_INCLUDE
        });
      });
      return this.toDetail(server, 0);
    } catch (error) {
      this.rethrowConstraint(error);
    }
  }

  /** Secret 留空表示保留，clearSecret 才会显式断开并删除旧凭据。 */
  async updateServer(
    id: string,
    payload: McpServerUpdateDto,
    userId: string
  ): Promise<McpServerDetail> {
    const current = await this.requireServer(id);
    const values = this.normalizeUpdate(payload, current);
    const effectiveAuthType = payload.authType ? this.authType(payload.authType) : current.authType;
    const authChanged = payload.authType !== undefined && effectiveAuthType !== current.authType;
    const encryptedCredential = this.credentialValue(payload, effectiveAuthType, authChanged);

    try {
      const server = await this.prisma.$transaction(async (tx) => {
        let secretId = current.secretId;
        if (encryptedCredential) {
          if (secretId) {
            await tx.mcpServerSecret.update({
              where: { id: secretId },
              data: { encryptedValue: encryptSecret(encryptedCredential), createdByUserId: userId }
            });
          } else {
            const secret = await tx.mcpServerSecret.create({
              data: { encryptedValue: encryptSecret(encryptedCredential), createdByUserId: userId }
            });
            secretId = secret.id;
          }
        } else if (
          (payload.clearSecret || (authChanged && effectiveAuthType === McpAuthType.NONE)) &&
          secretId
        ) {
          const obsoleteSecretId = secretId;
          secretId = null;
          await tx.mcpServer.update({ where: { id }, data: { secretId: null } });
          await tx.mcpServerSecret.delete({ where: { id: obsoleteSecretId } });
        }

        return tx.mcpServer.update({
          where: { id },
          data: {
            ...values,
            secretId,
            // 连接相关配置变化后回到 UNKNOWN，防止 UI 继续展示旧健康状态。
            healthStatus: McpHealthStatus.UNKNOWN,
            lastErrorCode: null,
            lastErrorMessage: null
          },
          include: SERVER_INCLUDE
        });
      });
      const enabledToolCount = await this.prisma.mcpServerTool.count({
        where: { serverId: id, enabled: true }
      });
      return this.toDetail(server, enabledToolCount);
    } catch (error) {
      this.rethrowConstraint(error);
    }
  }

  /** 软删除 Server，保留历史 Run Trace 引用的 runtimeId 和发现记录。 */
  async deleteServer(id: string): Promise<void> {
    await this.requireServer(id);
    await this.prisma.mcpServer.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false }
    });
  }

  /** 测试只读取远端工具数量，不修改本地 Tool 快照。 */
  async testConnection(id: string, signal?: AbortSignal): Promise<McpConnectionTestResult> {
    const server = await this.requireServer(id);
    const startedAt = Date.now();
    await this.prisma.mcpServer.update({
      where: { id },
      data: { healthStatus: McpHealthStatus.CONNECTING }
    });
    let client: ReturnType<McpProtocolClientFactory["create"]> | undefined;

    try {
      client = this.clientFactory.create(await this.toRuntimeConfig(server));
      const info = await client.connect(signal);
      const tools = await client.listTools(signal);
      const elapsedMs = Date.now() - startedAt;
      await this.prisma.mcpServer.update({
        where: { id },
        data: {
          healthStatus: McpHealthStatus.HEALTHY,
          negotiatedProtocolVersion: info.protocolVersion,
          serverInfo: this.toPrismaJson(info.serverInfo),
          capabilities: this.toPrismaJson(info.capabilities),
          lastConnectedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      return {
        ok: true,
        healthStatus: "healthy",
        protocolVersion: info.protocolVersion,
        toolCount: tools.length,
        elapsedMs
      };
    } catch (error) {
      const message = this.errorMessage(error);
      const healthStatus = this.classifyHealth(message);
      await this.prisma.mcpServer.update({
        where: { id },
        data: {
          healthStatus,
          lastErrorCode:
            healthStatus === McpHealthStatus.AUTH_REQUIRED ? "AUTH_REQUIRED" : "CONNECT_FAILED",
          lastErrorMessage: message
        }
      });
      return {
        ok: false,
        healthStatus: healthStatus.toLowerCase(),
        elapsedMs: Date.now() - startedAt,
        errorMessage: message
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  /**
   * 完整工具发现成功后才原子替换快照。失败时只更新 SyncRun/健康状态，
   * 绝不清空上一份可工作的定义，避免一次网络抖动让全部 Agent 工具消失。
   */
  async syncTools(
    id: string,
    signal?: AbortSignal,
    trigger: McpSyncTrigger = McpSyncTrigger.MANUAL
  ): Promise<McpSyncResult> {
    const server = await this.requireServer(id);
    const startedAt = Date.now();
    const syncRun = await this.prisma.mcpSyncRun.create({
      data: { serverId: id, status: McpSyncStatus.RUNNING, trigger }
    });
    let client: ReturnType<McpProtocolClientFactory["create"]> | undefined;

    try {
      client = this.clientFactory.create(await this.toRuntimeConfig(server));
      const info = await client.connect(signal);
      const tools = await client.listTools(signal);
      this.validateDiscoveredTools(tools);
      const now = new Date();
      const existing = await this.prisma.mcpServerTool.findMany({ where: { serverId: id } });
      const existingByName = new Map(existing.map((tool) => [tool.remoteName, tool]));
      let schemaChangedCount = 0;

      await this.prisma.$transaction(async (tx) => {
        for (const tool of tools) {
          const previous = existingByName.get(tool.name);
          const schemaHash = this.toolSchemaHash(tool);
          if (!previous || previous.schemaHash !== schemaHash) schemaChangedCount += 1;

          if (previous) {
            await tx.mcpServerTool.update({
              where: { id: previous.id },
              data: this.toolSnapshotData(tool, schemaHash, now)
            });
          } else {
            const toolId = randomUUID();
            await tx.mcpServerTool.create({
              data: {
                id: toolId,
                serverId: id,
                runtimeId: `mcp_${toolId}`,
                remoteName: tool.name,
                enabled: false,
                ...this.toolSnapshotData(tool, schemaHash, now)
              }
            });
          }
        }

        const seenNames = tools.map((tool) => tool.name);
        await tx.mcpServerTool.updateMany({
          where: { serverId: id, remoteName: { notIn: seenNames }, unavailableAt: null },
          data: { unavailableAt: now }
        });
        const elapsedMs = Date.now() - startedAt;
        await tx.mcpServer.update({
          where: { id },
          data: {
            healthStatus: McpHealthStatus.HEALTHY,
            negotiatedProtocolVersion: info.protocolVersion,
            serverInfo: this.toPrismaJson(info.serverInfo),
            capabilities: this.toPrismaJson(info.capabilities),
            lastConnectedAt: now,
            lastDiscoveredAt: now,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        await tx.mcpSyncRun.update({
          where: { id: syncRun.id },
          data: {
            status: McpSyncStatus.COMPLETED,
            toolCount: tools.length,
            schemaChangedCount,
            elapsedMs,
            completedAt: now
          }
        });
      });

      return {
        syncRunId: syncRun.id,
        status: "completed",
        toolCount: tools.length,
        schemaChangedCount,
        elapsedMs: Date.now() - startedAt
      };
    } catch (error) {
      const message = this.errorMessage(error);
      const elapsedMs = Date.now() - startedAt;
      await this.prisma.$transaction([
        this.prisma.mcpServer.update({
          where: { id },
          data: {
            healthStatus: this.classifyHealth(message),
            lastErrorCode: "DISCOVERY_FAILED",
            lastErrorMessage: message
          }
        }),
        this.prisma.mcpSyncRun.update({
          where: { id: syncRun.id },
          data: {
            status: McpSyncStatus.FAILED,
            errorCode: "DISCOVERY_FAILED",
            errorMessage: message,
            elapsedMs,
            completedAt: new Date()
          }
        })
      ]);
      return {
        syncRunId: syncRun.id,
        status: "failed",
        toolCount: 0,
        schemaChangedCount: 0,
        elapsedMs,
        errorMessage: message
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  async listTools(serverId: string): Promise<McpServerToolDetail[]> {
    await this.requireServer(serverId);
    const tools = await this.prisma.mcpServerTool.findMany({
      where: { serverId },
      orderBy: [{ unavailableAt: "asc" }, { remoteName: "asc" }]
    });
    return tools.map((tool) => this.toToolDetail(tool));
  }

  async updateTool(
    serverId: string,
    toolId: string,
    payload: McpServerToolUpdateDto
  ): Promise<McpServerToolDetail> {
    await this.requireServer(serverId);
    const current = await this.prisma.mcpServerTool.findFirst({ where: { id: toolId, serverId } });
    if (!current) throw new AppError(ErrorCodes.mcp.toolNotFound, "MCP Tool 不存在", 404);
    if (payload.enabled && current.unavailableAt) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "不可用的 MCP Tool 不能启用");
    }
    const tool = await this.prisma.mcpServerTool.update({
      where: { id: toolId },
      data: {
        enabled: payload.enabled,
        approvalMode:
          payload.approvalMode === undefined
            ? undefined
            : payload.approvalMode === null
              ? null
              : this.approvalMode(payload.approvalMode),
        riskLevel: payload.riskLevel ? this.riskLevel(payload.riskLevel) : undefined
      }
    });
    return this.toToolDetail(tool);
  }

  async listSyncRuns(serverId: string): Promise<McpSyncRunListItem[]> {
    await this.requireServer(serverId);
    const runs = await this.prisma.mcpSyncRun.findMany({
      where: { serverId },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return runs.map((run) => ({
      id: run.id,
      status: run.status.toLowerCase(),
      trigger: run.trigger.toLowerCase(),
      toolCount: run.toolCount,
      schemaChangedCount: run.schemaChangedCount,
      errorCode: run.errorCode ?? undefined,
      errorMessage: run.errorMessage ?? undefined,
      elapsedMs: run.elapsedMs ?? undefined,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString()
    }));
  }

  /** 周期同步兼作健康检查，并刷新远端工具 Schema；单实例内禁止重叠执行。 */
  private async runHealthPatrol(): Promise<void> {
    if (this.patrolRunning) return;
    this.patrolRunning = true;
    try {
      const servers = await this.prisma.mcpServer.findMany({
        where: { enabled: true, deletedAt: null },
        select: { id: true }
      });
      for (const server of servers) {
        try {
          await this.syncTools(server.id, undefined, McpSyncTrigger.SCHEDULED);
        } catch (error) {
          // 单个 Server 失败不能中断其余巡检，详细错误已由 syncTools 写入 SyncRun。
          this.logger.warn(
            `MCP 定时巡检失败: server=${server.id} error=${this.errorMessage(error)}`
          );
        }
      }
    } catch (error) {
      this.logger.warn(`MCP 定时巡检读取 Server 失败: ${this.errorMessage(error)}`);
    } finally {
      this.patrolRunning = false;
    }
  }

  /** 多次 list_changed 通知合并为一次同步，避免频繁变化击穿远端和数据库。 */
  private scheduleNotificationSync(serverId: string): void {
    const previous = this.notificationTimers.get(serverId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.notificationTimers.delete(serverId);
      void this.syncTools(serverId, undefined, McpSyncTrigger.NOTIFICATION).catch((error) => {
        this.logger.warn(
          `MCP 工具变化同步失败: server=${serverId} error=${this.errorMessage(error)}`
        );
      });
    }, 500);
    timer.unref();
    this.notificationTimers.set(serverId, timer);
  }

  private async requireServer(id: string): Promise<ServerWithSummary> {
    const server = await this.prisma.mcpServer.findFirst({
      where: { id, deletedAt: null },
      include: SERVER_INCLUDE
    });
    if (!server) throw new AppError(ErrorCodes.mcp.notFound, "MCP Server 不存在", 404);
    return server;
  }

  private runtimeToolWhere(): Prisma.McpServerToolWhereInput {
    return {
      enabled: true,
      unavailableAt: null,
      server: {
        enabled: true,
        deletedAt: null,
        healthStatus: { in: [McpHealthStatus.HEALTHY, McpHealthStatus.DEGRADED] }
      },
      OR: [
        { approvalMode: McpApprovalMode.AUTO },
        { approvalMode: null, server: { approvalMode: McpApprovalMode.AUTO } }
      ]
    };
  }

  private toRuntimeDefinition(
    tool: Prisma.McpServerToolGetPayload<object>
  ): McpRuntimeToolDefinition {
    const schema = this.jsonRecord(tool.inputSchema);
    return {
      id: tool.runtimeId,
      name: tool.title?.trim() || tool.remoteName,
      description: tool.description,
      enabled: true,
      inputSchema: {
        ...schema,
        type: "object"
      } as McpRuntimeToolDefinition["inputSchema"]
    };
  }

  private normalizeCreate(payload: McpServerCreateDto): Prisma.McpServerUncheckedCreateInput {
    const allowPrivateNetwork = payload.allowPrivateNetwork ?? false;
    const endpoint = this.endpoint(payload.endpoint, allowPrivateNetwork);
    const authType = this.authType(payload.authType ?? "none");
    this.requiredText(payload.name, "name");
    this.validateSlug(payload.slug);
    return {
      id: randomUUID(),
      name: payload.name.trim(),
      slug: payload.slug.trim(),
      description: payload.description?.trim() ?? "",
      endpoint,
      authType,
      authConfig: this.jsonInput(
        this.normalizeAuthConfig(authType, payload.authConfig ?? {}, allowPrivateNetwork)
      ),
      enabled: payload.enabled ?? true,
      allowPrivateNetwork,
      approvalMode: this.approvalMode(payload.approvalMode ?? "auto"),
      connectTimeoutMs: this.bounded(
        payload.connectTimeoutMs ?? 10_000,
        1_000,
        60_000,
        "connectTimeoutMs"
      ),
      toolTimeoutMs: this.bounded(payload.toolTimeoutMs ?? 30_000, 1_000, 300_000, "toolTimeoutMs"),
      maxResponseBytes: this.bounded(
        payload.maxResponseBytes ?? 1_000_000,
        1_024,
        10_000_000,
        "maxResponseBytes"
      ),
      maxOutputChars: this.bounded(
        payload.maxOutputChars ?? 20_000,
        1_000,
        200_000,
        "maxOutputChars"
      ),
      maxConcurrency: this.bounded(payload.maxConcurrency ?? 3, 1, 20, "maxConcurrency"),
      createdByUserId: ""
    };
  }

  private normalizeUpdate(
    payload: McpServerUpdateDto,
    current: ServerWithSummary
  ): Prisma.McpServerUncheckedUpdateInput {
    if (payload.name !== undefined) this.requiredText(payload.name, "name");
    if (payload.slug !== undefined) this.validateSlug(payload.slug);
    const allowPrivateNetwork = payload.allowPrivateNetwork ?? current.allowPrivateNetwork;
    const authType = payload.authType ? this.authType(payload.authType) : current.authType;
    const shouldNormalizeAuth =
      payload.authConfig !== undefined ||
      payload.authType !== undefined ||
      payload.allowPrivateNetwork !== undefined;
    const rawAuthConfig = payload.authConfig ?? this.jsonRecord(current.authConfig);
    return {
      name: payload.name?.trim(),
      slug: payload.slug?.trim(),
      description: payload.description?.trim(),
      endpoint:
        payload.endpoint || payload.allowPrivateNetwork !== undefined
          ? this.endpoint(payload.endpoint ?? current.endpoint, allowPrivateNetwork)
          : undefined,
      authType: payload.authType ? authType : undefined,
      authConfig: shouldNormalizeAuth
        ? this.jsonInput(this.normalizeAuthConfig(authType, rawAuthConfig, allowPrivateNetwork))
        : undefined,
      enabled: payload.enabled,
      allowPrivateNetwork: payload.allowPrivateNetwork,
      approvalMode: payload.approvalMode ? this.approvalMode(payload.approvalMode) : undefined,
      connectTimeoutMs:
        payload.connectTimeoutMs === undefined
          ? undefined
          : this.bounded(payload.connectTimeoutMs, 1_000, 60_000, "connectTimeoutMs"),
      toolTimeoutMs:
        payload.toolTimeoutMs === undefined
          ? undefined
          : this.bounded(payload.toolTimeoutMs, 1_000, 300_000, "toolTimeoutMs"),
      maxResponseBytes:
        payload.maxResponseBytes === undefined
          ? undefined
          : this.bounded(payload.maxResponseBytes, 1_024, 10_000_000, "maxResponseBytes"),
      maxOutputChars:
        payload.maxOutputChars === undefined
          ? undefined
          : this.bounded(payload.maxOutputChars, 1_000, 200_000, "maxOutputChars"),
      maxConcurrency:
        payload.maxConcurrency === undefined
          ? undefined
          : this.bounded(payload.maxConcurrency, 1, 20, "maxConcurrency")
    };
  }

  private async toRuntimeConfig(server: ServerWithSummary): Promise<McpClientRuntimeConfig> {
    // 普通管理查询只读取 secretConfigured；仅在真正建立连接前才按需取密文并解密。
    const storedSecret = server.secretId
      ? await this.prisma.mcpServerSecret.findUnique({
          where: { id: server.secretId },
          select: { encryptedValue: true }
        })
      : null;
    const decrypted = storedSecret ? decryptSecret(storedSecret.encryptedValue) : undefined;
    return {
      serverId: server.id,
      endpoint: server.endpoint,
      authType: server.authType.toLowerCase() as McpClientRuntimeConfig["authType"],
      authConfig: this.jsonRecord(server.authConfig),
      ...this.decodeCredential(server.authType, decrypted),
      authCacheKey: `${server.id}:${server.updatedAt.getTime()}`,
      allowPrivateNetwork: server.allowPrivateNetwork,
      connectTimeoutMs: server.connectTimeoutMs,
      toolTimeoutMs: server.toolTimeoutMs
    };
  }

  private validateDiscoveredTools(tools: McpProtocolTool[]): void {
    const names = new Set<string>();
    for (const tool of tools) {
      if (!tool.name || tool.name.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(tool.name)) {
        throw new Error(`invalid MCP tool name: ${tool.name}`);
      }
      if (names.has(tool.name)) throw new Error(`duplicate MCP tool name: ${tool.name}`);
      names.add(tool.name);
      if (
        !tool.inputSchema ||
        typeof tool.inputSchema !== "object" ||
        Array.isArray(tool.inputSchema)
      ) {
        throw new Error(`invalid inputSchema for MCP tool: ${tool.name}`);
      }
    }
  }

  private toolSnapshotData(tool: McpProtocolTool, schemaHash: string, now: Date) {
    return {
      title: tool.title,
      description: tool.description ?? "",
      inputSchema: this.jsonInput(tool.inputSchema),
      outputSchema: tool.outputSchema ? this.jsonInput(tool.outputSchema) : Prisma.JsonNull,
      annotations: tool.annotations ? this.jsonInput(tool.annotations) : Prisma.JsonNull,
      schemaHash,
      lastSeenAt: now,
      unavailableAt: null
    };
  }

  private toolSchemaHash(tool: McpProtocolTool): string {
    return createHash("sha256")
      .update(
        this.stableJson({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations
        })
      )
      .digest("hex");
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(",")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private toListItem(server: ServerWithSummary, enabledToolCount: number): McpServerListItem {
    return {
      id: server.id,
      name: server.name,
      slug: server.slug,
      description: server.description,
      endpoint: server.endpoint,
      authType: server.authType.toLowerCase() as McpServerListItem["authType"],
      authConfig: this.jsonRecord(server.authConfig),
      secretConfigured: Boolean(server.secret),
      enabled: server.enabled,
      allowPrivateNetwork: server.allowPrivateNetwork,
      approvalMode: server.approvalMode.toLowerCase() as McpServerListItem["approvalMode"],
      healthStatus: server.healthStatus.toLowerCase(),
      protocolVersion: server.negotiatedProtocolVersion ?? undefined,
      toolCount: server._count.tools,
      enabledToolCount,
      lastConnectedAt: server.lastConnectedAt?.toISOString(),
      lastDiscoveredAt: server.lastDiscoveredAt?.toISOString(),
      lastErrorCode: server.lastErrorCode ?? undefined,
      lastErrorMessage: server.lastErrorMessage ?? undefined,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString()
    };
  }

  private toDetail(server: ServerWithSummary, enabledToolCount: number): McpServerDetail {
    return {
      ...this.toListItem(server, enabledToolCount),
      connectTimeoutMs: server.connectTimeoutMs,
      toolTimeoutMs: server.toolTimeoutMs,
      maxResponseBytes: server.maxResponseBytes,
      maxOutputChars: server.maxOutputChars,
      maxConcurrency: server.maxConcurrency,
      serverInfo: server.serverInfo ? this.jsonRecord(server.serverInfo) : undefined,
      capabilities: server.capabilities ? this.jsonRecord(server.capabilities) : undefined
    };
  }

  private toToolDetail(tool: Prisma.McpServerToolGetPayload<object>): McpServerToolDetail {
    return {
      id: tool.id,
      serverId: tool.serverId,
      remoteName: tool.remoteName,
      runtimeId: tool.runtimeId,
      title: tool.title ?? undefined,
      description: tool.description,
      inputSchema: this.jsonRecord(tool.inputSchema),
      outputSchema: tool.outputSchema ? this.jsonRecord(tool.outputSchema) : undefined,
      annotations: tool.annotations ? this.jsonRecord(tool.annotations) : undefined,
      enabled: tool.enabled,
      approvalMode: tool.approvalMode?.toLowerCase() as McpServerToolDetail["approvalMode"],
      riskLevel: tool.riskLevel.toLowerCase() as McpServerToolDetail["riskLevel"],
      available: tool.unavailableAt === null,
      schemaHash: tool.schemaHash,
      lastSeenAt: tool.lastSeenAt.toISOString()
    };
  }

  private endpoint(raw: string, allowPrivateNetwork: boolean): string {
    return this.validatedUrl(raw, allowPrivateNetwork, "MCP endpoint");
  }

  private validatedUrl(raw: string, allowPrivateNetwork: boolean, label: string): string {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `${label} 不是合法 URL`);
    }
    if (url.username || url.password || url.hash) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `${label} 不允许凭据或 fragment`);
    }
    if (url.protocol !== "https:" && !(allowPrivateNetwork && url.protocol === "http:")) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `公网 ${label} 必须使用 HTTPS`);
    }
    return url.toString();
  }

  /** 公开 authConfig 只保存协议参数，clientSecret 等凭据必须走加密表。 */
  private normalizeAuthConfig(
    authType: McpAuthType,
    raw: Record<string, unknown>,
    allowPrivateNetwork: boolean
  ): Record<string, unknown> {
    if (authType === McpAuthType.NONE || authType === McpAuthType.BEARER) return {};
    if (authType === McpAuthType.API_KEY_HEADER) {
      const headerName = String(raw.headerName ?? "").trim();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) {
        throw new AppError(ErrorCodes.mcp.invalidConfiguration, "API Key Header 名称不合法");
      }
      return { headerName };
    }

    const defaultTtlSeconds = this.bounded(
      Number(raw.defaultTtlSeconds ?? 300),
      30,
      86_400,
      "defaultTtlSeconds"
    );
    const refreshBeforeSeconds = this.bounded(
      Number(raw.refreshBeforeSeconds ?? 60),
      0,
      defaultTtlSeconds - 1,
      "refreshBeforeSeconds"
    );
    const clientAuthMethod = raw.clientAuthMethod === "basic" ? "basic" : "body";
    return {
      tokenUrl: this.validatedUrl(String(raw.tokenUrl ?? ""), allowPrivateNetwork, "Token URL"),
      clientAuthMethod,
      scope: typeof raw.scope === "string" ? raw.scope.trim() : "",
      audience: typeof raw.audience === "string" ? raw.audience.trim() : "",
      tokenField: String(raw.tokenField ?? "access_token").trim() || "access_token",
      expiresInField: String(raw.expiresInField ?? "expires_in").trim() || "expires_in",
      tokenTypeField: String(raw.tokenTypeField ?? "token_type").trim() || "token_type",
      defaultTtlSeconds,
      refreshBeforeSeconds
    };
  }

  /** 静态 Token 与动态 Client 凭据共用密文表，但用不同运行时字段避免误用。 */
  private credentialValue(
    payload: Pick<McpServerCreateDto, "secret" | "credentials">,
    authType: McpAuthType,
    required: boolean
  ): string | undefined {
    if (authType === McpAuthType.NONE) return undefined;
    if (authType === McpAuthType.CLIENT_CREDENTIALS) {
      const clientId = payload.credentials?.clientId?.trim();
      const clientSecret = payload.credentials?.clientSecret;
      if (!clientId || !clientSecret) {
        if (required) {
          throw new AppError(
            ErrorCodes.mcp.invalidConfiguration,
            "Client ID 和 Client Secret 不能为空"
          );
        }
        return undefined;
      }
      return JSON.stringify({ clientId, clientSecret });
    }
    if (!payload.secret) {
      if (required) throw new AppError(ErrorCodes.mcp.invalidConfiguration, "鉴权凭据不能为空");
      return undefined;
    }
    return payload.secret;
  }

  private decodeCredential(
    authType: McpAuthType,
    value?: string
  ): Pick<McpClientRuntimeConfig, "secret" | "credentials"> {
    if (!value) return {};
    if (authType !== McpAuthType.CLIENT_CREDENTIALS) return { secret: value };
    try {
      const credentials = JSON.parse(value) as Record<string, unknown>;
      if (
        typeof credentials.clientId !== "string" ||
        typeof credentials.clientSecret !== "string"
      ) {
        throw new Error("invalid credential fields");
      }
      return {
        credentials: {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret
        }
      };
    } catch {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP 动态鉴权凭据损坏，请重新配置");
    }
  }

  private authType(value: string): McpAuthType {
    const result = McpAuthType[value.toUpperCase() as keyof typeof McpAuthType];
    if (!result) throw new AppError(ErrorCodes.mcp.invalidConfiguration, "不支持的 MCP 鉴权类型");
    return result;
  }

  private approvalMode(value: string): McpApprovalMode {
    const result = McpApprovalMode[value.toUpperCase() as keyof typeof McpApprovalMode];
    if (!result) throw new AppError(ErrorCodes.mcp.invalidConfiguration, "不支持的审批模式");
    return result;
  }

  private riskLevel(value: string): McpRiskLevel {
    const result = McpRiskLevel[value.toUpperCase() as keyof typeof McpRiskLevel];
    if (!result) throw new AppError(ErrorCodes.mcp.invalidConfiguration, "不支持的风险等级");
    return result;
  }

  private requiredText(value: string, field: string): void {
    if (!value?.trim())
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `${field} 不能为空`);
  }

  private validateSlug(value: string): void {
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(value.trim())) {
      throw new AppError(
        ErrorCodes.mcp.invalidConfiguration,
        "slug 必须是 2-63 位小写字母、数字或连字符"
      );
    }
  }

  private bounded(value: number, min: number, max: number, field: string): number {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `${field} 必须在 ${min}-${max} 之间`);
    }
    return value;
  }

  private jsonInput(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toPrismaJson(
    value: unknown
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
    return value === undefined ? undefined : this.jsonInput(value);
  }

  private classifyHealth(message: string): McpHealthStatus {
    return /\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(message)
      ? McpHealthStatus.AUTH_REQUIRED
      : McpHealthStatus.UNAVAILABLE;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 2_000) : "unknown MCP error";
  }

  private rethrowConstraint(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(ErrorCodes.mcp.slugExists, "MCP Server slug 已存在", 409);
    }
    throw error;
  }
}
