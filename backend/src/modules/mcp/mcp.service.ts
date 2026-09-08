import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { basename, extname } from "node:path";

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
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
import { KnowledgeService } from "../knowledge/knowledge.service";
import { SkillsService } from "../skills/skills.service";
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
import { McpOAuthManager } from "./clients/mcp-oauth.manager";
import { McpRedactor } from "./mcp-redaction";
import {
  McpRuntimeResolutionError,
  McpRuntimeToolCatalogItem,
  McpRuntimeToolConfig,
  McpRuntimeToolDefinition
} from "./dto/mcp-runtime.dto";
import {
  McpResourceCatalog,
  McpResourceImportDto,
  McpResourceImportResult,
  McpResourcePreview
} from "./dto/mcp-resource.dto";
import {
  McpPromptCatalog,
  McpPromptGetDto,
  McpPromptImportDto,
  McpPromptImportResult,
  McpPromptPreview
} from "./dto/mcp-prompt.dto";

const SERVER_INCLUDE = {
  secret: { select: { id: true } },
  oauthAuthorization: { select: { authorizedAt: true } },
  _count: { select: { tools: true } }
} satisfies Prisma.McpServerInclude;
const MAX_RESOURCE_PREVIEW_CHARS = 50_000;
const MAX_RESOURCE_IMPORT_BYTES = 5 * 1024 * 1024;

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
    private readonly clientFactory: McpProtocolClientFactory,
    private readonly oauthManager: McpOAuthManager,
    @Optional() private readonly knowledgeService?: KnowledgeService,
    @Optional() private readonly skillsService?: SkillsService,
    private readonly redactor: McpRedactor = new McpRedactor()
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

  /** 向统一工具目录暴露 AUTO 与 CONFIRM Tool；DISABLED 策略仍在目录层过滤。 */
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

  /** 目录检索不读取 Schema；风险等级和 Server 名作为标签参与本地召回。 */
  async getRuntimeToolCatalog(runtimeIds: string[]): Promise<McpRuntimeToolCatalogItem[]> {
    if (runtimeIds.length === 0) return [];
    const tools = await this.prisma.mcpServerTool.findMany({
      where: { ...this.runtimeToolWhere(), runtimeId: { in: runtimeIds } },
      select: {
        runtimeId: true,
        remoteName: true,
        title: true,
        description: true,
        riskLevel: true,
        server: { select: { name: true, slug: true } }
      }
    });
    return tools.map((tool) => ({
      id: tool.runtimeId,
      name: tool.title?.trim() || tool.remoteName,
      description: tool.description,
      enabled: true,
      source: "mcp",
      tags: [tool.server.name, tool.server.slug, tool.riskLevel.toLowerCase()]
    }));
  }

  /** Resource 目录是实时只读视图，不保存正文，也不展开 URI Template。 */
  async listResources(serverId: string, signal?: AbortSignal): Promise<McpResourceCatalog> {
    return this.withProtocolClient(serverId, signal, async (client) => {
      const catalog = await client.listResources(signal);
      return {
        resources: catalog.resources.map((item) => ({
          uri: this.requiredProtocolString(item.uri, "Resource uri"),
          name: this.requiredProtocolString(item.name, "Resource name"),
          title: this.optionalProtocolString(item.title),
          description: this.optionalProtocolString(item.description),
          mimeType: this.optionalProtocolString(item.mimeType),
          size: typeof item.size === "number" && item.size >= 0 ? item.size : undefined
        })),
        templates: catalog.templates.map((item) => ({
          uriTemplate: this.requiredProtocolString(item.uriTemplate, "Resource uriTemplate"),
          name: this.requiredProtocolString(item.name, "Resource Template name"),
          title: this.optionalProtocolString(item.title),
          description: this.optionalProtocolString(item.description),
          mimeType: this.optionalProtocolString(item.mimeType)
        }))
      };
    });
  }

  async previewResource(
    serverId: string,
    payload: { uri?: string },
    signal?: AbortSignal
  ): Promise<McpResourcePreview> {
    const uri = this.resourceUri(payload.uri);
    const resource = await this.readTextResource(serverId, uri, signal);
    const originalChars = resource.text.length;
    return {
      uri,
      mimeType: resource.mimeType,
      text: resource.text.slice(0, MAX_RESOURCE_PREVIEW_CHARS),
      truncated: originalChars > MAX_RESOURCE_PREVIEW_CHARS,
      originalChars
    };
  }

  /** 导入是管理员显式动作；远端文本仍通过 KnowledgeService 的标准文件入口建立索引。 */
  async importResource(
    serverId: string,
    payload: McpResourceImportDto,
    signal?: AbortSignal
  ): Promise<McpResourceImportResult> {
    const uri = this.resourceUri(payload.uri);
    const knowledgeBaseId = String(payload.knowledgeBaseId ?? "").trim();
    if (!knowledgeBaseId) {
      throw new AppError(ErrorCodes.common.badRequest, "knowledgeBaseId 不能为空");
    }
    const resource = await this.readTextResource(serverId, uri, signal);
    const buffer = Buffer.from(resource.text, "utf8");
    if (buffer.byteLength > MAX_RESOURCE_IMPORT_BYTES) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Resource 超过 5 MB 导入限制");
    }
    const filename = this.resourceFilename(payload.filename, uri, resource.mimeType);
    const document = await this.requireKnowledgeService().uploadKnowledgeDocument(knowledgeBaseId, {
      originalname: filename,
      mimetype: resource.mimeType,
      size: buffer.byteLength,
      buffer
    });
    return { serverId, resourceUri: uri, document };
  }

  /** Prompt 目录只保留安全元数据；消息内容必须由管理员显式预览后才会读取。 */
  async listPrompts(serverId: string, signal?: AbortSignal): Promise<McpPromptCatalog> {
    return this.withProtocolClient(serverId, signal, async (client) => {
      const catalog = await client.listPrompts(signal);
      return {
        prompts: catalog.prompts.map((item) => ({
          name: this.promptName(item.name),
          title: this.optionalProtocolString(item.title),
          description: this.optionalProtocolString(item.description),
          arguments: Array.isArray(item.arguments)
            ? item.arguments.slice(0, 50).map((argument) => {
                const value = this.protocolRecord(argument, "MCP Prompt 参数定义不合法");
                return {
                  name: this.promptArgumentName(value.name),
                  description: this.optionalProtocolString(value.description),
                  required: value.required === true
                };
              })
            : []
        }))
      };
    });
  }

  async previewPrompt(
    serverId: string,
    payload: McpPromptGetDto,
    signal?: AbortSignal
  ): Promise<McpPromptPreview> {
    const name = this.promptName(payload.name);
    const args = this.promptArguments(payload.arguments);
    const prompt = await this.readTextPrompt(serverId, name, args, signal);
    return { name, description: prompt.description, text: prompt.text, messageCount: prompt.count };
  }

  /** 每次导入都新建停用 Skill 草稿，远端变化永远不会覆盖本地管理员修订。 */
  async importPrompt(
    serverId: string,
    payload: McpPromptImportDto,
    userId: string,
    signal?: AbortSignal
  ): Promise<McpPromptImportResult> {
    const name = this.promptName(payload.name);
    const args = this.promptArguments(payload.arguments);
    const prompt = await this.readTextPrompt(serverId, name, args, signal);
    if (prompt.text.length > 8_000) {
      throw new AppError(
        ErrorCodes.mcp.invalidConfiguration,
        "MCP Prompt 超过 8,000 字符 Skill 限制"
      );
    }
    const server = await this.requireServer(serverId);
    const skill = await this.requireSkillsService().createImportedDraft(
      {
        name: this.optionalProtocolString(payload.skillName) ?? name,
        description: prompt.description ?? `从 MCP Server ${server.name} 导入`,
        instructions: prompt.text,
        sourceType: "mcp_prompt",
        sourceRef: { serverId, serverName: server.name, promptName: name, arguments: args }
      },
      userId
    );
    return { serverId, promptName: name, skill };
  }

  /**
   * 执行前重新读取 Server/Tool 状态，不能信任模型生成定义时的旧快照。
   * 这样管理员停用 Server 或 Tool 后，进行中的会话也会立即阻止下一次调用。
   */
  async resolveRuntimeTool(
    runtimeId: string,
    approvalGranted = false
  ): Promise<McpRuntimeToolConfig | null> {
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
      !approvalGranted &&
      (tool.approvalMode === McpApprovalMode.CONFIRM ||
        (!tool.approvalMode && tool.server.approvalMode === McpApprovalMode.CONFIRM))
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
      sensitiveInputPaths: this.stringList(tool.sensitiveInputPaths),
      sensitiveOutputPaths: this.stringList(tool.sensitiveOutputPaths),
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

  /** Runtime Event、审批卡片和日志共享同一份 MCP 输入脱敏视图。 */
  async sanitizeRuntimeInput(
    runtimeId: string,
    input: Record<string, import("../tools/dto/tool.dto").ToolJsonValue>
  ): Promise<Record<string, import("../tools/dto/tool.dto").ToolJsonValue>> {
    const tool = await this.prisma.mcpServerTool.findUnique({
      where: { runtimeId },
      select: { sensitiveInputPaths: true }
    });
    return this.redactor.redactJson(input, this.stringList(tool?.sensitiveInputPaths));
  }

  /** 创建仅持久化配置，不在事务中访问远端；管理员可随后显式测试和同步。 */
  async createServer(payload: McpServerCreateDto, userId: string): Promise<McpServerDetail> {
    const values = this.normalizeCreate(payload);
    const encryptedCredential = this.credentialValue(payload, values.authType as McpAuthType, true);
    try {
      // Secret 与 Server 引用必须原子创建，避免产生孤立密钥或缺少凭据的运行配置。
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
    const allowPrivateNetwork = payload.allowPrivateNetwork ?? current.allowPrivateNetwork;
    const oauthConfigChanged =
      payload.authConfig !== undefined &&
      this.stableJson(
        this.normalizeAuthConfig(effectiveAuthType, payload.authConfig, allowPrivateNetwork)
      ) !== this.stableJson(this.jsonRecord(current.authConfig));
    const oauthNeedsReauthorization =
      current.authType === McpAuthType.OAUTH &&
      (authChanged ||
        oauthConfigChanged ||
        payload.credentials !== undefined ||
        (payload.endpoint !== undefined &&
          this.endpoint(payload.endpoint, allowPrivateNetwork) !== current.endpoint) ||
        (payload.allowPrivateNetwork !== undefined &&
          allowPrivateNetwork !== current.allowPrivateNetwork));

    try {
      // 配置、Secret 生命周期和 OAuth 失效处理必须原子提交，运行时不能观察到半更新状态。
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
        if (oauthNeedsReauthorization) {
          // OAuth Client、Scope 或资源地址变化后，旧 Token 的受众与授权范围不再可信。
          await tx.mcpOAuthAuthorization.deleteMany({ where: { serverId: id } });
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
    let runtimeConfig: McpClientRuntimeConfig | undefined;

    try {
      runtimeConfig = await this.toRuntimeConfig(server);
      client = this.clientFactory.create(runtimeConfig);
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
      const message = this.errorMessage(error, runtimeConfig);
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
    let runtimeConfig: McpClientRuntimeConfig | undefined;

    try {
      runtimeConfig = await this.toRuntimeConfig(server);
      client = this.clientFactory.create(runtimeConfig);
      const info = await client.connect(signal);
      const tools = await client.listTools(signal);
      this.validateDiscoveredTools(tools);
      const now = new Date();
      const existing = await this.prisma.mcpServerTool.findMany({ where: { serverId: id } });
      const existingByName = new Map(existing.map((tool) => [tool.remoteName, tool]));
      let schemaChangedCount = 0;

      // 工具快照、Server 健康状态与同步任务结果必须一起落库，保证目录版本可追溯。
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
      const message = this.errorMessage(error, runtimeConfig);
      const elapsedMs = Date.now() - startedAt;
      // 同步失败时 Server 健康状态与 SyncRun 必须使用同一失败快照。
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
        riskLevel: payload.riskLevel ? this.riskLevel(payload.riskLevel) : undefined,
        sensitiveInputPaths:
          payload.sensitiveInputPaths === undefined
            ? undefined
            : this.jsonInput(this.sensitivePaths(payload.sensitiveInputPaths)),
        sensitiveOutputPaths:
          payload.sensitiveOutputPaths === undefined
            ? undefined
            : this.jsonInput(this.sensitivePaths(payload.sensitiveOutputPaths))
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

  async startOAuthAuthorization(
    serverId: string,
    userId: string
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    const server = await this.requireServer(serverId);
    if (server.authType !== McpAuthType.OAUTH) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "该 MCP Server 未配置 OAuth");
    }
    return this.oauthManager.startAuthorization(serverId, userId);
  }

  async completeOAuthAuthorization(input: {
    state: string;
    code?: string;
    iss?: string;
    error?: string;
  }): Promise<string> {
    return this.oauthManager.completeAuthorization(input);
  }

  async revokeOAuthAuthorization(serverId: string): Promise<void> {
    const server = await this.requireServer(serverId);
    if (server.authType !== McpAuthType.OAUTH) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "该 MCP Server 未配置 OAuth");
    }
    await this.oauthManager.revoke(serverId);
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

  /**
   * Resource 管理操作使用短连接，避免预览连接进入 Runtime 连接池。
   * 连接配置复用 Tool Runtime 的网络、鉴权与超时策略，确保管理端没有绕过 SSRF 防护。
   */
  private async withProtocolClient<T>(
    serverId: string,
    signal: AbortSignal | undefined,
    operation: (client: ReturnType<McpProtocolClientFactory["create"]>) => Promise<T>
  ): Promise<T> {
    const server = await this.requireServer(serverId);
    if (!server.enabled) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Server 已停用");
    }
    if (server.healthStatus === McpHealthStatus.AUTH_REQUIRED) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Server 需要重新鉴权");
    }

    const runtimeConfig = await this.toRuntimeConfig(server);
    const client = this.clientFactory.create(runtimeConfig);
    try {
      await client.connect(signal);
      return await operation(client);
    } catch (error) {
      throw new AppError(
        ErrorCodes.mcp.invalidConfiguration,
        this.errorMessage(error, runtimeConfig)
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** Resource URI 可以是自定义 scheme，但不能包含控制字符或无限增长。 */
  private resourceUri(value: unknown): string {
    const uri = String(value ?? "").trim();
    if (!uri || uri.length > 8_192 || [...uri].some((character) => this.isControl(character))) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Resource URI 不合法");
    }
    return uri;
  }

  private requiredProtocolString(value: unknown, label: string): string {
    const text = this.optionalProtocolString(value);
    if (!text) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, `${label} 不能为空`);
    }
    return text;
  }

  /** 协议元数据属于不可信外部输入，返回管理端前去掉控制字符并限制展示长度。 */
  private optionalProtocolString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const text = [...value]
      .map((character) => (this.isControl(character) ? " " : character))
      .join("")
      .trim();
    return text ? text.slice(0, 2_000) : undefined;
  }

  private async readTextResource(
    serverId: string,
    uri: string,
    signal?: AbortSignal
  ): Promise<{ text: string; mimeType: string }> {
    return this.withProtocolClient(serverId, signal, async (client) => {
      const result = await client.readResource(uri, signal);
      const textParts: string[] = [];
      let mimeType = "text/plain";

      for (const content of result.contents) {
        if (typeof content.mimeType === "string" && content.mimeType.trim()) {
          mimeType = content.mimeType.trim().slice(0, 255);
        }
        if (typeof content.text === "string") textParts.push(content.text);
      }

      if (textParts.length === 0) {
        throw new AppError(
          ErrorCodes.mcp.invalidConfiguration,
          "MCP Resource 不是可预览或导入的文本资源"
        );
      }
      const text = textParts.join("\n\n");
      if (Buffer.byteLength(text, "utf8") > MAX_RESOURCE_IMPORT_BYTES) {
        throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Resource 超过 5 MB 读取限制");
      }
      return { text, mimeType };
    });
  }

  /** 仅生成知识库当前支持的文本扩展名，防止远端 URI 伪装成可执行文件。 */
  private resourceFilename(value: unknown, uri: string, mimeType: string): string {
    let filename = typeof value === "string" ? basename(value.trim()) : "";
    if (!filename) {
      try {
        filename = basename(new URL(uri).pathname);
      } catch {
        filename = basename(uri.split(/[?#]/, 1)[0]);
      }
    }
    filename = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
    if (!filename) filename = "mcp-resource";

    const mimeExtension = mimeType.includes("json")
      ? ".json"
      : mimeType.includes("markdown")
        ? ".md"
        : mimeType.includes("csv")
          ? ".csv"
          : ".txt";
    const extension = extname(filename).toLowerCase();
    if (![".txt", ".md", ".markdown", ".csv", ".json"].includes(extension)) {
      filename = `${filename}${mimeExtension}`;
    }
    return filename.slice(-240);
  }

  private requireKnowledgeService(): KnowledgeService {
    if (!this.knowledgeService) {
      throw new AppError(ErrorCodes.common.internal, "KnowledgeService 未注册", 500);
    }
    return this.knowledgeService;
  }

  private promptName(value: unknown): string {
    const name = String(value ?? "").trim();
    if (!name || name.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(name)) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Prompt 名称不合法");
    }
    return name;
  }

  private promptArgumentName(value: unknown): string {
    const name = String(value ?? "").trim();
    if (!name || name.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(name)) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Prompt 参数名不合法");
    }
    return name;
  }

  private promptArguments(value: unknown): Record<string, string> {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Prompt arguments 必须是对象");
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 50) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, "MCP Prompt 参数不能超过 50 个");
    }
    return Object.fromEntries(
      entries.map(([key, item]) => {
        const name = this.promptArgumentName(key);
        if (typeof item !== "string" || item.length > 2_000) {
          throw new AppError(
            ErrorCodes.mcp.invalidConfiguration,
            `MCP Prompt 参数 ${name} 必须是字符串`
          );
        }
        return [name, item];
      })
    );
  }

  private protocolRecord(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(ErrorCodes.mcp.invalidConfiguration, message);
    }
    return value as Record<string, unknown>;
  }

  private async readTextPrompt(
    serverId: string,
    name: string,
    args: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ description?: string; text: string; count: number }> {
    return this.withProtocolClient(serverId, signal, async (client) => {
      const result = await client.getPrompt(name, args, signal);
      const messages: string[] = [];
      for (const message of result.messages) {
        const role = message.role === "assistant" ? "Assistant" : "User";
        const content = this.protocolRecord(message.content, "MCP Prompt Message content 不合法");
        if (typeof content.text === "string" && content.text.trim()) {
          messages.push(`## ${role}\n\n${content.text.trim()}`);
        }
      }
      if (messages.length === 0) {
        throw new AppError(
          ErrorCodes.mcp.invalidConfiguration,
          "MCP Prompt 不包含可导入的文本消息"
        );
      }
      return {
        description: this.optionalProtocolString(result.description),
        text: messages.join("\n\n"),
        count: result.messages.length
      };
    });
  }

  private requireSkillsService(): SkillsService {
    if (!this.skillsService) {
      throw new AppError(ErrorCodes.common.internal, "SkillsService 未注册", 500);
    }
    return this.skillsService;
  }

  private isControl(character: string): boolean {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
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
      NOT: {
        OR: [
          { approvalMode: McpApprovalMode.DISABLED },
          { approvalMode: null, server: { approvalMode: McpApprovalMode.DISABLED } }
        ]
      }
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
      oauthAuthorized: Boolean(server.oauthAuthorization?.authorizedAt),
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
      sensitiveInputPaths: this.stringList(tool.sensitiveInputPaths),
      sensitiveOutputPaths: this.stringList(tool.sensitiveOutputPaths),
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
    if (authType === McpAuthType.OAUTH) {
      const clientAuthMethod = String(raw.clientAuthMethod ?? "none");
      if (!["none", "client_secret_basic", "client_secret_post"].includes(clientAuthMethod)) {
        throw new AppError(ErrorCodes.mcp.invalidConfiguration, "OAuth Client 认证方式不合法");
      }
      return {
        scope: typeof raw.scope === "string" ? raw.scope.trim() : "",
        clientAuthMethod
      };
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
    if (authType === McpAuthType.OAUTH) {
      const clientId = payload.credentials?.clientId?.trim();
      const clientSecret = payload.credentials?.clientSecret;
      if (!clientId && !clientSecret) return undefined;
      if (!clientId) {
        throw new AppError(
          ErrorCodes.mcp.invalidConfiguration,
          "OAuth Client Secret 不能脱离 Client ID 配置"
        );
      }
      return JSON.stringify({ clientId, clientSecret: clientSecret ?? "" });
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
    if (authType !== McpAuthType.CLIENT_CREDENTIALS && authType !== McpAuthType.OAUTH) {
      return { secret: value };
    }
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

  private stringList(value: Prisma.JsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private sensitivePaths(value: unknown): string[] {
    try {
      return this.redactor.normalizePaths(value);
    } catch (error) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        error instanceof Error ? error.message : "敏感字段路径不合法"
      );
    }
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

  private errorMessage(error: unknown, config?: McpClientRuntimeConfig): string {
    const message = error instanceof Error ? error.message : "unknown MCP error";
    const secrets = config
      ? [config.secret, ...Object.values(config.credentials ?? {})].filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    return this.redactor.redactText(message, secrets).slice(0, 2_000);
  }

  private rethrowConstraint(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(ErrorCodes.mcp.slugExists, "MCP Server slug 已存在", 409);
    }
    throw error;
  }
}
