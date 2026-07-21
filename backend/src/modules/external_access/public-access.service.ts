import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "../agents/agents.service";
import {
  AgentPublicAccessConfig,
  AgentPublicAccessRuntime,
  SharedAgentDetail
} from "../agents/dto/agent.dto";
import { PasswordService } from "../auth/password.service";
import {
  PublicAccessConfigResponse,
  UpdatePublicAccessConfigDto
} from "./dto/external-access.dto";

const MAX_ALLOWED_ORIGINS = 20;

@Injectable()
export class PublicAccessService {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly passwordService: PasswordService
  ) {}

  /**
   * 返回可公开展示的 Agent 信息，并在资料加载阶段就阻断已过期或不受信任的来源。
   *
   * Token 本身只能定位 Agent；来源白名单和密码属于发布治理规则，必须由本服务统一执行，
   * 不能交由 Widget 自己判断。
   */
  async getPublicProfile(agentToken: string, origin?: string): Promise<SharedAgentDetail> {
    const agent = await this.resolveRuntime(agentToken, origin);

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelName: agent.modelName,
      providerName: agent.providerName,
      passwordRequired: agent.passwordRequired
    };
  }

  /** 验证访问密码而不持久化浏览器状态，密码仅由 Widget 临时保存在内存。 */
  async verifyAccess(agentToken: string, origin: string | undefined, password?: string): Promise<void> {
    const agent = await this.resolveRuntime(agentToken, origin);
    await this.assertPassword(agent, password);
  }

  /** 聊天和历史恢复都通过这个方法取得已完成治理校验的运行时 Agent。 */
  async resolvePublicAgent(
    agentToken: string,
    origin: string | undefined,
    password?: string
  ): Promise<AgentPublicAccessRuntime> {
    const agent = await this.resolveRuntime(agentToken, origin);
    await this.assertPassword(agent, password);
    return agent;
  }

  /** 读取管理端展示所需的治理配置，密码哈希永远不离开 Agents 模块。 */
  async getConfig(agentId: string): Promise<PublicAccessConfigResponse> {
    return this.toConfigResponse(await this.agentsService.getPublicAccessConfig(agentId));
  }

  /**
   * 更新发布治理配置。
   *
   * 先读取当前设置再做合并，保证前端仅提交某一个字段时不会意外清空其他安全设置。
   */
  async updateConfig(
    agentId: string,
    payload: UpdatePublicAccessConfigDto
  ): Promise<PublicAccessConfigResponse> {
    const current = await this.agentsService.getPublicAccessConfig(agentId);
    const expiresAt =
      payload.publicExpiresAt === undefined
        ? current.publicExpiresAt
        : this.normalizeExpiresAt(payload.publicExpiresAt);
    const allowedOrigins =
      payload.allowedOrigins === undefined
        ? current.publicAllowedOrigins
        : this.normalizeOrigins(payload.allowedOrigins);
    const passwordHash = await this.resolvePasswordHash(payload.password);
    const config = await this.agentsService.updatePublicAccessConfig(agentId, {
      publicExpiresAt: expiresAt,
      publicAllowedOrigins: allowedOrigins,
      publicPasswordHash: passwordHash
    });

    return this.toConfigResponse(config);
  }

  /** Token 轮换是紧急止损操作，旧分享链接和嵌入脚本会立即失效。 */
  async rotateToken(agentId: string) {
    return this.agentsService.rotateShareToken(agentId);
  }

  /** 统一解析运行时 Agent，并强制匹配配置的浏览器 Origin。 */
  private async resolveRuntime(
    agentToken: string,
    origin?: string
  ): Promise<AgentPublicAccessRuntime> {
    const agent = await this.agentsService.getPublicAccessRuntime(agentToken);
    this.assertAllowedOrigin(agent.publicAllowedOrigins, origin);
    return agent;
  }

  /**
   * 白名单非空时不接受缺失 Origin 的请求，避免客户端伪装成非浏览器来绕过域名限制。
   *
   * 默认空白名单仍允许所有来源，保持 v1.1 已发布分享链接的兼容性。
   */
  private assertAllowedOrigin(allowedOrigins: string[], origin?: string): void {
    if (allowedOrigins.length === 0) {
      return;
    }

    if (!origin || !allowedOrigins.includes(origin)) {
      throw new AppError(ErrorCodes.common.forbidden, "公开访问来源未获授权", HttpStatus.FORBIDDEN);
    }
  }

  /** 仅在 Agent 配置了密码时验证，未配置时不会要求 Widget 无意义地传空密码。 */
  private async assertPassword(agent: AgentPublicAccessRuntime, password?: string): Promise<void> {
    if (!agent.publicPasswordHash) {
      return;
    }

    const verified =
      Boolean(password) &&
      (await this.passwordService.verifyPassword(agent.publicPasswordHash, password ?? ""));

    if (!verified) {
      throw new AppError(ErrorCodes.common.forbidden, "公开访问密码错误", HttpStatus.FORBIDDEN);
    }
  }

  /** 校验时间格式和未来约束，防止管理员误填一个已过期的公开链接。 */
  private normalizeExpiresAt(value: string | null): Date | null {
    if (value === null || value.trim() === "") {
      return null;
    }

    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new AppError(ErrorCodes.common.badRequest, "公开链接到期时间必须晚于当前时间", HttpStatus.BAD_REQUEST);
    }

    return expiresAt;
  }

  /** 将白名单归一为 URL origin，拒绝带路径、查询参数或非 HTTP(S) 协议的模糊配置。 */
  private normalizeOrigins(origins: string[]): string[] {
    if (origins.length > MAX_ALLOWED_ORIGINS) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `最多允许配置 ${MAX_ALLOWED_ORIGINS} 个访问域名`,
        HttpStatus.BAD_REQUEST
      );
    }

    const normalized = origins
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          const url = new URL(value);
          if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value) {
            throw new Error("invalid origin");
          }
          return url.origin;
        } catch {
          throw new AppError(
            ErrorCodes.common.badRequest,
            `访问域名格式错误：${value}，请填写例如 https://example.com`,
            HttpStatus.BAD_REQUEST
          );
        }
      });

    return [...new Set(normalized)];
  }

  /** undefined 保留密码，null 清除密码，非空字符串按统一账户密码策略哈希。 */
  private async resolvePasswordHash(value: string | null | undefined): Promise<string | null | undefined> {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === "") {
      return null;
    }

    this.passwordService.validatePasswordStrength(value);
    return this.passwordService.hashPassword(value);
  }

  private toConfigResponse(config: AgentPublicAccessConfig): PublicAccessConfigResponse {
    return {
      agentId: config.agentId,
      publicExpiresAt: config.publicExpiresAt,
      allowedOrigins: config.publicAllowedOrigins,
      passwordRequired: config.passwordRequired
    };
  }
}
