import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "../agents/agents.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AgentApiKeyListItem,
  CreateAgentApiKeyDto,
  CreatedAgentApiKey
} from "./dto/external-access.dto";

const MAX_KEY_NAME_LENGTH = 80;

@Injectable()
export class AgentApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService
  ) {}

  /** 创建一把仅能调用指定 Agent 的服务端 Key，并且只在本次响应暴露明文。 */
  async create(
    agentId: string,
    createdById: string,
    payload: CreateAgentApiKeyDto
  ): Promise<CreatedAgentApiKey> {
    await this.agentsService.getAgent(agentId);
    const name = this.normalizeName(payload.name);
    const expiresAt = this.normalizeExpiresAt(payload.expiresAt);
    const { rawKey, keyPrefix, keyHash } = this.createRawKey();
    const record = await this.prisma.agentApiKey.create({
      data: {
        agentId,
        createdById,
        name,
        keyPrefix,
        keyHash,
        expiresAt
      }
    });

    return {
      ...this.toListItem(record),
      apiKey: rawKey
    };
  }

  /** 列表接口绝不返回 keyHash 或原始 Key，只保留可审计的前缀与使用时间。 */
  /** 查询指定 Agent 的所有 Key 状态，管理员可据此识别过期、撤销或长期未使用的凭证。 */
  async list(agentId: string): Promise<AgentApiKeyListItem[]> {
    await this.agentsService.getAgent(agentId);
    const records = await this.prisma.agentApiKey.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" }
    });

    return records.map((record) => this.toListItem(record));
  }

  /** 撤销会立即让 Guard 无法继续解析旧 Key，不依赖缓存自然过期。 */
  /** 将 Key 标记为撤销；保留记录而非物理删除，确保安全事件仍可审计。 */
  async revoke(agentId: string, keyId: string): Promise<void> {
    const result = await this.prisma.agentApiKey.updateMany({
      where: {
        id: keyId,
        agentId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    if (result.count === 0) {
      throw new AppError(ErrorCodes.common.notFound, "Agent API Key 不存在", HttpStatus.NOT_FOUND);
    }
  }

  /**
   * 轮换采用“先新建、后撤销旧 Key”的事务语义：调用方拿到新 Key 后旧 Key 已失效，
   * 不会出现两个长期有效 Key 被误认为同一部署环境凭证的情况。
   */
  async rotate(agentId: string, keyId: string, createdById: string): Promise<CreatedAgentApiKey> {
    const existing = await this.prisma.agentApiKey.findFirst({
      where: {
        id: keyId,
        agentId,
        revokedAt: null
      }
    });

    if (!existing) {
      throw new AppError(ErrorCodes.common.notFound, "Agent API Key 不存在", HttpStatus.NOT_FOUND);
    }

    const { rawKey, keyPrefix, keyHash } = this.createRawKey();
    // 轮换必须先撤销旧 Key 再创建新 Key，并在同一事务中保证任一时刻只有一把有效密钥。
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.agentApiKey.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() }
      });

      return transaction.agentApiKey.create({
        data: {
          agentId,
          createdById,
          name: existing.name,
          keyPrefix,
          keyHash,
          expiresAt: existing.expiresAt
        }
      });
    });

    return {
      ...this.toListItem(record),
      apiKey: rawKey
    };
  }

  /** Guard 使用 SHA-256 查找可用 Key；更新 lastUsedAt 失败不应阻断模型调用。 */
  async authenticate(rawKey: string): Promise<{ id: string; agentId: string } | null> {
    if (!rawKey.startsWith("mia_agent_")) {
      return null;
    }

    const keyHash = this.hashKey(rawKey);
    const record = await this.prisma.agentApiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        agent: {
          published: true,
          enabled: true,
          deletedAt: null
        }
      },
      select: {
        id: true,
        agentId: true
      }
    });

    if (!record) {
      return null;
    }

    void this.prisma.agentApiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() }
      })
      .catch(() => undefined);

    return record;
  }

  /** 使用高熵随机字节生成 Key，并拆出短前缀供管理页辨识而不暴露完整凭证。 */
  private createRawKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
    const keyPrefix = `mia_agent_${randomBytes(4).toString("hex")}`;
    const rawKey = `${keyPrefix}_${randomBytes(32).toString("base64url")}`;

    return {
      rawKey,
      keyPrefix,
      keyHash: this.hashKey(rawKey)
    };
  }

  /** 哈希是 Key 的唯一持久化形态，数据库泄露时不能反推出可调用 Agent 的凭证。 */
  private hashKey(rawKey: string): string {
    return createHash("sha256").update(rawKey).digest("hex");
  }

  /** 规范化部署名称，避免无名称或超长名称使 Key 轮换记录难以分辨。 */
  private normalizeName(value: string | undefined): string {
    const name = value?.trim();

    if (!name || name.length > MAX_KEY_NAME_LENGTH) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `Key 名称不能为空且不能超过 ${MAX_KEY_NAME_LENGTH} 个字符`
      );
    }

    return name;
  }

  /** 显式校验过期时间，拒绝已过期 Key 在创建时就进入无效状态。 */
  private normalizeExpiresAt(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }

    const expiresAt = new Date(value);

    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new AppError(ErrorCodes.common.badRequest, "过期时间必须晚于当前时间");
    }

    return expiresAt;
  }

  /** 将 Prisma 记录收敛为安全的管理端 DTO，刻意排除 keyHash。 */
  private toListItem(record: {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): AgentApiKeyListItem {
    return {
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      createdAt: record.createdAt
    };
  }
}
