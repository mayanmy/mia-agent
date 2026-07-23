import { HttpStatus, Injectable } from "@nestjs/common";
import { AgentRunSource, ExternalUserSource } from "@prisma/client";

import { AppError, ErrorCodes } from "../../core/errors";
import { AgentsService } from "../agents/agents.service";
import { ChatRequestContext, ChatService } from "../chat/chat.service";
import { ChatCompletionDto, ChatStreamEvent } from "../chat/dto/chat.dto";
import { PrismaService } from "../prisma/prisma.service";
import {
  ExternalConversationListItem,
  ExternalMessageListItem,
  PublicAgentProfile
} from "./dto/external-access.dto";

const EXTERNAL_USER_PATTERN = /^[A-Za-z0-9_.:@-]{1,256}$/u;
const MAX_CONVERSATION_LIST_SIZE = 100;

type ExternalConversationOwner = {
  agentId: string;
  source: ExternalUserSource;
  externalId: string;
  conversationId?: string;
};

@Injectable()
export class ExternalAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly chatService: ChatService
  ) {}

  /** 公开资料只返回 Widget 需要展示的字段，不泄露模型配置、Prompt 或绑定资源。 */
  async getPublicAgentProfile(agentToken: string): Promise<PublicAgentProfile> {
    const agent = await this.agentsService.getSharedAgent(agentToken);

    return {
      ...agent,
      passwordRequired: Boolean(agent.passwordRequired)
    };
  }

  /**
   * 编排一条外部流式消息。
   *
   * 外部消息由本模块在调用 ChatService 前后持久化；ChatService 只接收受控历史进行 RAG、
   * 工具和模型流式编排，避免反向依赖 ExternalConversation 数据模型。
   */
  async *streamMessage(
    owner: ExternalConversationOwner,
    payload: ChatCompletionDto,
    signal?: AbortSignal,
    requestId?: string
  ): AsyncIterable<ChatStreamEvent> {
    const conversation = await this.resolveConversation(owner);
    const runtime = await this.agentsService.getAgentRuntimeConfig(owner.agentId);
    const history = await this.getModelHistory(conversation.id, runtime.historyTurns);
    const message = payload.message?.trim() ?? "";

    await this.prisma.externalMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: message,
        metadata: this.toAttachmentMetadata(payload)
      }
    });
    await this.touchConversation(conversation.id);

    let assistantContent = "";
    let completed = false;
    const chatContext: ChatRequestContext = {
      requestId,
      source:
        owner.source === ExternalUserSource.SERVICE_API
          ? AgentRunSource.SERVICE_API
          : AgentRunSource.PUBLIC_WIDGET,
      externalConversationId: conversation.id,
      externalHistory: history,
      skipInternalSessionPersistence: true
    };

    for await (const event of this.chatService.streamCompletion(
      {
        ...payload,
        agentId: owner.agentId,
        history: []
      },
      signal,
      chatContext
    )) {
      if (event.type === "message_start") {
        yield {
          ...event,
          data: {
            ...event.data,
            conversationId: conversation.id
          }
        };
        continue;
      }

      if (event.type === "token") {
        assistantContent += String(event.data.content ?? "");
      }

      if (event.type === "message_end") {
        completed = true;
      }

      yield event;
    }

    // 只有收到 message_end 才写入助手消息；用户取消或模型出错时不把半截输出伪装成完整回答。
    if (completed && assistantContent.trim()) {
      await this.prisma.externalMessage.create({
        data: {
          conversationId: conversation.id,
          role: "assistant",
          content: assistantContent
        }
      });
      await this.touchConversation(conversation.id);
    }
  }

  /** Service API 按 Agent + user 查询会话，user 不匹配时统一返回不存在，避免枚举。 */
  /** 列出一个 Service API user 在当前 Agent 下的会话，不跨 Agent 或 user 聚合。 */
  async listConversations(
    agentId: string,
    user: string,
    limit?: string
  ): Promise<ExternalConversationListItem[]> {
    const externalId = this.normalizeExternalId(user);
    const take = this.normalizeLimit(limit);
    const endUser = await this.findEndUser(agentId, ExternalUserSource.SERVICE_API, externalId);

    if (!endUser) {
      return [];
    }

    const conversations = await this.prisma.externalConversation.findMany({
      where: {
        agentId,
        externalEndUserId: endUser.id,
        source: ExternalUserSource.SERVICE_API,
        deletedAt: null
      },
      orderBy: { updatedAt: "desc" },
      take
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }));
  }

  /** 读取会话消息前先以 Agent + source + user 校验归属，避免只凭 conversationId 越权。 */
  async listMessages(
    agentId: string,
    user: string,
    conversationId: string,
    limit?: string
  ): Promise<ExternalMessageListItem[]> {
    return this.listConversationMessages(
      {
        agentId,
        source: ExternalUserSource.SERVICE_API,
        externalId: this.normalizeExternalId(user),
        conversationId
      },
      limit
    );
  }

  /** Public Widget 与 Service API 复用同一归属校验和消息投影，避免两条入口行为漂移。 */
  async listConversationMessages(
    owner: Required<ExternalConversationOwner>,
    limit?: string
  ): Promise<ExternalMessageListItem[]> {
    const conversation = await this.requireConversation(owner);
    const messages = await this.prisma.externalMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: this.normalizeLimit(limit)
    });

    return messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    }));
  }

  /** 找到已有会话或创建新会话，同时刷新外部用户的最近访问时间。 */
  private async resolveConversation(owner: ExternalConversationOwner) {
    const externalId = this.normalizeExternalId(owner.externalId);
    const endUser = await this.upsertEndUser(owner.agentId, owner.source, externalId);

    if (owner.conversationId) {
      return this.requireConversation({
        ...owner,
        externalId,
        conversationId: owner.conversationId
      });
    }

    return this.prisma.externalConversation.create({
      data: {
        agentId: owner.agentId,
        externalEndUserId: endUser.id,
        source: owner.source
      }
    });
  }

  /** 用完整 owner 条件读取会话；对不存在与越权返回同一错误以防止会话枚举。 */
  private async requireConversation(owner: Required<ExternalConversationOwner>) {
    const endUser = await this.findEndUser(owner.agentId, owner.source, owner.externalId);
    const conversation = endUser
      ? await this.prisma.externalConversation.findFirst({
          where: {
            id: owner.conversationId,
            agentId: owner.agentId,
            externalEndUserId: endUser.id,
            source: owner.source,
            deletedAt: null
          }
        })
      : null;

    if (!conversation) {
      throw new AppError(
        ErrorCodes.externalAccess.conversationNotFound,
        "会话不存在或无权访问",
        HttpStatus.NOT_FOUND
      );
    }

    return conversation;
  }

  /** 按 Agent、来源和外部隔离键建立唯一 End User，不把业务 user 写入工作台 users 表。 */
  private async upsertEndUser(agentId: string, source: ExternalUserSource, externalId: string) {
    const now = new Date();

    return this.prisma.externalEndUser.upsert({
      where: {
        agentId_source_externalId: {
          agentId,
          source,
          externalId
        }
      },
      create: {
        agentId,
        source,
        externalId,
        firstSeenAt: now,
        lastSeenAt: now
      },
      update: {
        lastSeenAt: now
      }
    });
  }

  /** 查询外部用户时必须带来源，防止 Widget session 与 Service API user 发生同名混用。 */
  private findEndUser(agentId: string, source: ExternalUserSource, externalId: string) {
    return this.prisma.externalEndUser.findFirst({
      where: { agentId, source, externalId }
    });
  }

  /** 仅取模型配置允许的最近轮次，外部会话全部历史不应无上限进入 Prompt。 */
  private async getModelHistory(conversationId: string, historyTurns: number) {
    const take = Math.max(0, historyTurns) * 2;

    if (take === 0) {
      return [];
    }

    const rows = await this.prisma.externalMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take
    });

    return rows.reverse().map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content
    }));
  }

  /** 消息写入后刷新会话排序时间，服务端查询可按最近活跃会话展示。 */
  private touchConversation(conversationId: string): Promise<unknown> {
    return this.prisma.externalConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });
  }

  /** 验证 Service user 与 Widget sessionId 的可控字符集，拒绝空白与控制字符。 */
  private normalizeExternalId(value: string | undefined): string {
    const externalId = value?.trim() ?? "";

    if (!EXTERNAL_USER_PATTERN.test(externalId)) {
      throw new AppError(
        ErrorCodes.externalAccess.invalidExternalUser,
        "user 或 sessionId 格式不合法"
      );
    }

    return externalId;
  }

  /** 为外部查询设置上限，避免调用方一次性导出无限量历史。 */
  private normalizeLimit(value: string | undefined): number {
    const parsed = Number(value ?? 20);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 20;
    }

    return Math.min(parsed, MAX_CONVERSATION_LIST_SIZE);
  }

  /** 只保存附件描述元数据，不将 data URL 等大字段复制进外部消息表。 */
  private toAttachmentMetadata(payload: ChatCompletionDto) {
    const images = payload.images?.map((image) => ({ name: image.name, mimeType: image.mimeType }));
    const files = payload.files?.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size
    }));

    return images?.length || files?.length ? { images, files } : undefined;
  }
}
