import { HttpStatus, Injectable } from "@nestjs/common";
import {
  ChatMessageFeedbackRating,
  ChatSessionMessageRole,
  ChatSessionStatus,
  Prisma
} from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { PrismaService } from "../prisma/prisma.service";
import {
  ChatMessageQueryDto,
  ChatMessageMetadata,
  ChatMessageFeedbackDto,
  ChatMessageFeedbackResponse,
  ChatSessionListItem,
  ChatSessionListQueryDto,
  ChatSessionListResponse,
  ChatSessionMessagePage,
  UpdateChatSessionDto
} from "./dto/chat-session.dto";

const DEFAULT_SESSION_PAGE_SIZE = 30;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SESSION_TITLE = "新对话";
const MAX_SESSION_TITLE_LENGTH = 80;
const MAX_GENERATED_TITLE_LENGTH = 40;

/** 用于限定会话数据归属，所有读写都必须同时匹配 Agent 和当前用户。 */
type SessionOwner = {
  /** 会话所属 Agent ID。 */
  agentId: string;
  /** 会话所属内部用户 ID。 */
  userId: string;
};

/** 消息按创建时间倒序翻页时使用的复合游标，id 用于解决同毫秒排序冲突。 */
type CreatedAtCursor = {
  /** 同一创建时间下用于稳定排序的消息 ID。 */
  id: string;
  /** 消息创建时间。 */
  createdAt: Date;
};
/** 会话按最近更新时间倒序翻页时使用的复合游标。 */
type UpdatedAtCursor = {
  /** 同一更新时间下用于稳定排序的会话 ID。 */
  id: string;
  /** 会话最近更新时间。 */
  updatedAt: Date;
};

/** 解码并校验后的通用复合游标。 */
type DecodedCursor = {
  /** 同一时间下用于稳定排序的记录 ID。 */
  id: string;
  /** 已转换为 Date 的排序时间。 */
  date: Date;
};

/** 转换会话列表 DTO 所需的最小数据库记录。 */
type SessionListRecord = {
  /** 会话 ID。 */
  id: string;
  /** 会话所属 Agent ID。 */
  agentId: string;
  /** 会话标题。 */
  title: string;
  /** 会话生命周期状态。 */
  status: ChatSessionStatus;
  /** 最近消息时间。 */
  lastMessageAt: Date | null;
  /** 会话创建时间。 */
  createdAt: Date;
  /** 会话最近更新时间。 */
  updatedAt: Date;
};

@Injectable()
export class ChatSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建一条全新的保留会话。
   *
   * 不再使用 agentId + userId upsert；用户主动点击“新建对话”必须得到独立上下文，
   * 以免新问题意外携带旧会话历史。
   */
  async createSession(owner: SessionOwner): Promise<ChatSessionListItem> {
    const session = await this.prisma.chatSession.create({
      data: {
        agentId: owner.agentId,
        userId: owner.userId,
        title: DEFAULT_SESSION_TITLE
      }
    });

    return this.toSessionListItem(session);
  }

  /** 获取当前成员在一个 Agent 下的会话列表，默认只显示未归档会话。 */
  async listSessions(
    owner: SessionOwner,
    query: ChatSessionListQueryDto
  ): Promise<ChatSessionListResponse> {
    const pageSize = this.normalizePageSize(query.pageSize, DEFAULT_SESSION_PAGE_SIZE);
    const cursor = this.decodeUpdatedAtCursor(query.cursor);
    const status = query.status ?? ChatSessionStatus.ACTIVE;
    const where: Prisma.ChatSessionWhereInput = {
      agentId: owner.agentId,
      userId: owner.userId,
      status,
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.chatSession.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize + 1
    });
    const hasMore = rows.length > pageSize;
    const list = rows.slice(0, pageSize).map((item) => this.toSessionListItem(item));
    const lastItem = list[list.length - 1];

    return {
      list,
      hasMore,
      nextCursor:
        hasMore && lastItem
          ? this.encodeCursor({ updatedAt: lastItem.updatedAt.toISOString(), id: lastItem.id })
          : null
    };
  }

  /**
   * 获取消息历史的一页。查询采用“比当前最早消息更早”的游标，结果再反转为时间正序，
   * 前端可以安全 prepend，不会因为新消息插入而发生 Offset 偏移。
   */
  async getMessagePage(
    sessionId: string,
    owner: SessionOwner,
    query: ChatMessageQueryDto
  ): Promise<ChatSessionMessagePage> {
    await this.requireSession(sessionId, owner);
    const pageSize = this.normalizePageSize(query.pageSize, DEFAULT_MESSAGE_PAGE_SIZE);
    const before = this.decodeCreatedAtCursor(query.before);
    const rows = await this.prisma.chatSessionMessage.findMany({
      where: {
        sessionId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } }
              ]
            }
          : {})
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      include: {
        feedbacks: {
          where: { userId: owner.userId },
          take: 1
        }
      }
    });
    const hasMore = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize);
    const oldest = pageRows[pageRows.length - 1];

    return {
      list: pageRows.reverse().map((item) => ({
        id: item.id,
        role: item.role === ChatSessionMessageRole.USER ? "user" : "assistant",
        content: item.content,
        metadata: this.toMessageMetadata(item.metadata),
        feedback: item.feedbacks[0]
          ? {
              messageId: item.id,
              rating: item.feedbacks[0].rating,
              reason: item.feedbacks[0].reason
            }
          : null,
        createdAt: item.createdAt
      })),
      hasMore,
      nextBefore:
        hasMore && oldest
          ? this.encodeCursor({ createdAt: oldest.createdAt.toISOString(), id: oldest.id })
          : null
    };
  }

  /** 修改会话标题；标题为空会造成列表难以区分，因此明确拒绝。 */
  async updateSession(
    sessionId: string,
    owner: SessionOwner,
    payload: UpdateChatSessionDto
  ): Promise<ChatSessionListItem> {
    const title = this.normalizeTitle(payload.title);
    await this.requireSession(sessionId, owner);
    const session = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { title }
    });

    return this.toSessionListItem(session);
  }

  /** 归档不会删除消息，用户可以在后续版本恢复或查看旧讨论。 */
  async archiveSession(sessionId: string, owner: SessionOwner): Promise<ChatSessionListItem> {
    await this.requireSession(sessionId, owner);
    const session = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: ChatSessionStatus.ARCHIVED,
        archivedAt: new Date()
      }
    });

    return this.toSessionListItem(session);
  }

  /** 恢复已归档会话；活跃会话重复恢复时保持幂等结果。 */
  async restoreSession(sessionId: string, owner: SessionOwner): Promise<ChatSessionListItem> {
    await this.requireSession(sessionId, owner);
    const session = await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        status: ChatSessionStatus.ACTIVE,
        archivedAt: null
      }
    });

    return this.toSessionListItem(session);
  }

  /**
   * 仅允许删除已经归档的会话，防止操作菜单误触直接清空正在使用的对话。
   *
   * ChatSessionMessage 配置了 onDelete: Cascade，因此删除会话时数据库会在同一约束链内
   * 清理对应消息，不需要应用层逐条删除。
   */
  async deleteSession(sessionId: string, owner: SessionOwner): Promise<void> {
    const session = await this.requireSession(sessionId, owner);

    if (session.status !== ChatSessionStatus.ARCHIVED) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "active chat session must be archived before deletion",
        HttpStatus.CONFLICT
      );
    }

    await this.prisma.chatSession.delete({ where: { id: sessionId } });
  }

  /** 仅按当前成员查找会话，用于消息详情接口先取得其所属 Agent 再完成模式校验。 */
  async getOwnedSession(sessionId: string, userId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId }
    });

    if (!session) {
      throw new AppError(ErrorCodes.common.notFound, "chat session not found", HttpStatus.NOT_FOUND);
    }

    return session;
  }

  /** 流式调用前验证会话归属与活跃状态，禁止将归档会话继续写入。 */
  async requireActiveSession(sessionId: string, owner: SessionOwner) {
    const session = await this.requireSession(sessionId, owner);

    if (session.status !== ChatSessionStatus.ACTIVE) {
      throw new AppError(
        ErrorCodes.common.conflict,
        "chat session is archived",
        HttpStatus.CONFLICT
      );
    }

    return session;
  }

  /** 为模型只读取最近若干轮原文；页面分页数量不能影响 LLM 上下文大小。 */
  async buildModelHistory(sessionId: string, historyTurns: number) {
    const take = Math.max(0, historyTurns) * 2;

    if (take === 0) {
      return [];
    }

    const rows = await this.prisma.chatSessionMessage.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take
    });

    return rows.reverse().map((item) => ({
      role: item.role === ChatSessionMessageRole.USER ? ("user" as const) : ("assistant" as const),
      content: item.content
    }));
  }

  /**
   * 追加消息并刷新会话排序时间。第一条用户消息会自动生成标题，但只在标题仍为默认值时更新，
   * 不覆盖用户已经手动修改的标题。
   */
  async appendMessage(
    sessionId: string,
    role: ChatSessionMessageRole,
    content: string,
    metadata?: ChatMessageMetadata
  ): Promise<string | null> {
    if (!content.trim()) {
      return null;
    }

    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const message = await transaction.chatSessionMessage.create({
        data: {
          sessionId,
          role,
          content,
          metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined
        }
      });
      await transaction.chatSession.update({
        where: { id: sessionId },
        data: {
          lastMessageAt: now,
          updatedAt: now
        }
      });

      if (role === ChatSessionMessageRole.USER) {
        await transaction.chatSession.updateMany({
          where: { id: sessionId, title: DEFAULT_SESSION_TITLE },
          data: { title: this.createTitleFromMessage(content) }
        });
      }
      return message.id;
    });
  }

  async upsertMessageFeedback(
    messageId: string,
    userId: string,
    payload: ChatMessageFeedbackDto
  ): Promise<ChatMessageFeedbackResponse> {
    const rating = payload.rating;
    const reason = payload.reason?.trim() || null;
    if (rating !== "UP" && rating !== "DOWN") {
      throw new AppError(ErrorCodes.common.badRequest, "feedback rating must be UP or DOWN");
    }
    if (reason && reason.length > 500) {
      throw new AppError(ErrorCodes.common.badRequest, "feedback reason cannot exceed 500 characters");
    }
    const message = await this.prisma.chatSessionMessage.findFirst({
      where: {
        id: messageId,
        role: ChatSessionMessageRole.ASSISTANT,
        session: { userId }
      },
      select: { id: true }
    });
    if (!message) {
      throw new AppError(ErrorCodes.common.notFound, "chat message not found", HttpStatus.NOT_FOUND);
    }
    const feedback = await this.prisma.chatMessageFeedback.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, rating: rating as ChatMessageFeedbackRating, reason },
      update: { rating: rating as ChatMessageFeedbackRating, reason }
    });
    return { messageId, rating: feedback.rating, reason: feedback.reason };
  }

  /** Prisma JsonValue 经过边界检查后转换为稳定 DTO，旧数据或非对象值统一忽略。 */
  private toMessageMetadata(value: Prisma.JsonValue | null): ChatMessageMetadata | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as ChatMessageMetadata;
  }

  /** 按复合归属读取会话，避免只凭可猜测 ID 越权访问。 */
  private async requireSession(sessionId: string, owner: SessionOwner) {
    const session = await this.prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        agentId: owner.agentId,
        userId: owner.userId
      }
    });

    if (!session) {
      // 统一返回 not found，不向调用方泄露某个 sessionId 是否属于其他成员。
      throw new AppError(ErrorCodes.common.notFound, "chat session not found", HttpStatus.NOT_FOUND);
    }

    return session;
  }

  /** 将字符串页大小归一到安全范围，拒绝非法分页输入。 */
  private normalizePageSize(value: string | undefined, fallback: number): number {
    if (value === undefined || value === "") {
      return fallback;
    }

    const pageSize = Number(value);

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`
      );
    }

    return pageSize;
  }

  /** 清洗用户标题并限制长度。 */
  private normalizeTitle(value: unknown): string {
    if (typeof value !== "string") {
      throw new AppError(ErrorCodes.common.badRequest, "title is required");
    }

    const title = value.trim();

    if (!title || title.length > MAX_SESSION_TITLE_LENGTH) {
      throw new AppError(
        ErrorCodes.common.badRequest,
        `title must be between 1 and ${MAX_SESSION_TITLE_LENGTH} characters`
      );
    }

    return title;
  }

  /** 从首条消息生成简短标题，去除连续空白和附件上下文。 */
  private createTitleFromMessage(content: string): string {
    const normalized = content.replace(/\s+/gu, " ").trim();
    return normalized.slice(0, MAX_GENERATED_TITLE_LENGTH) || DEFAULT_SESSION_TITLE;
  }

  /** 解码消息分页游标。 */
  private decodeCreatedAtCursor(value: string | undefined): CreatedAtCursor | null {
    const decoded = this.decodeCursor(value, "createdAt");
    return decoded ? { id: decoded.id, createdAt: decoded.date } : null;
  }

  /** 解码会话分页游标。 */
  private decodeUpdatedAtCursor(value: string | undefined): UpdatedAtCursor | null {
    const decoded = this.decodeCursor(value, "updatedAt");
    return decoded ? { id: decoded.id, updatedAt: decoded.date } : null;
  }

  /** 校验 Base64 JSON 游标的字段和值，防止畸形游标影响查询条件。 */
  private decodeCursor(
    value: string | undefined,
    field: "createdAt" | "updatedAt"
  ): DecodedCursor | null {
    if (!value) {
      return null;
    }

    try {
      const decoded = Buffer.from(value, "base64url").toString("utf8");
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      const rawDate = parsed[field];
      const date = typeof rawDate === "string" ? new Date(rawDate) : null;

      if (!date || Number.isNaN(date.getTime()) || typeof parsed.id !== "string" || !parsed.id) {
        throw new Error("invalid cursor");
      }

      return { id: parsed.id, date };
    } catch {
      throw new AppError(ErrorCodes.common.badRequest, "invalid chat cursor");
    }
  }

  /** 将游标编码为 URL 安全的 Base64 字符串。 */
  private encodeCursor(cursor: Record<string, string>): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }

  /** 隔离 Prisma 结果并返回稳定的跨层 DTO。 */
  private toSessionListItem(session: SessionListRecord): ChatSessionListItem {
    return {
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      status: session.status,
      lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }
}
