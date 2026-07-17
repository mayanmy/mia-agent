import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { IncomingMessage, ServerResponse } from "node:http";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Public } from "../../core/auth/public.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import { AgentApiKeysService } from "./agent-api-keys.service";
import {
  CreateAgentApiKeyDto,
  ExternalConversationListQueryDto,
  ExternalConversationMessageQueryDto,
  PublicChatMessageDto,
  ServiceChatMessageDto
} from "./dto/external-access.dto";
import { ExternalAccessService } from "./external-access.service";
import { ExternalRateLimiterService } from "./external-rate-limiter.service";
import { AgentApiKeyGuard, AgentApiKeyRequest } from "./guards/agent-api-key.guard";

@Controller("agents")
export class AgentApiKeysController {
  constructor(private readonly agentApiKeysService: AgentApiKeysService) {}

  @Post(":agentId/api-keys")
  @Roles(UserRole.ADMIN, UserRole.USER)
  /** 创建后只返回一次明文 Key，前端必须提示管理员立即复制到业务后端。 */
  create(
    @Param("agentId") agentId: string,
    @Body() payload: CreateAgentApiKeyDto,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.agentApiKeysService.create(agentId, currentUser.id, payload);
  }

  @Get(":agentId/api-keys")
  @Roles(UserRole.ADMIN, UserRole.USER)
  /** 返回安全脱敏后的 Key 列表，供管理端检查使用和撤销状态。 */
  list(@Param("agentId") agentId: string) {
    return this.agentApiKeysService.list(agentId);
  }

  @Delete(":agentId/api-keys/:keyId")
  @Roles(UserRole.ADMIN, UserRole.USER)
  /** 撤销泄露或不再使用的 Key，旧 Key 之后立即无法通过 AgentApiKeyGuard。 */
  async revoke(@Param("agentId") agentId: string, @Param("keyId") keyId: string): Promise<null> {
    await this.agentApiKeysService.revoke(agentId, keyId);
    return null;
  }

  @Post(":agentId/api-keys/:keyId/rotate")
  @Roles(UserRole.ADMIN, UserRole.USER)
  /** 轮换会创建新 Key 并撤销旧 Key，响应中的新明文同样只出现一次。 */
  rotate(
    @Param("agentId") agentId: string,
    @Param("keyId") keyId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.agentApiKeysService.rotate(agentId, keyId, currentUser.id);
  }
}

@Controller("public")
@Public()
export class PublicAgentsController {
  constructor(
    private readonly externalAccessService: ExternalAccessService,
    private readonly rateLimiter: ExternalRateLimiterService
  ) {}

  @Get("agents/:agentToken")
  /** Widget 只需要公开资料，接口在查询前按 token + IP 做基础限流。 */
  async getAgent(@Param("agentToken") agentToken: string, @Req() request: IncomingMessage) {
    this.rateLimiter.assertAllowed("public-profile", `${agentToken}:${this.getClientIp(request)}`, 60);
    return this.externalAccessService.getPublicAgentProfile(agentToken);
  }

  @Post("chat-messages")
  /** 公开 Widget 的流式入口：token 只识别发布 Agent，sessionId 仅作为匿名隔离键。 */
  async chat(
    @Body() payload: PublicChatMessageDto,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse
  ): Promise<void> {
    const sessionId = payload.sessionId?.trim() ?? "";
    const agentToken = payload.agentToken?.trim() ?? "";
    this.rateLimiter.assertAllowed(
      "public-chat",
      `${agentToken}:${sessionId}:${this.getClientIp(request)}`,
      20
    );
    const agent = await this.externalAccessService.getPublicAgentProfile(agentToken);

    await streamSse(request, response, (signal) =>
      this.externalAccessService.streamMessage(
        {
          agentId: agent.id,
          source: "WIDGET",
          externalId: sessionId,
          conversationId: payload.conversationId
        },
        {
          agentId: agent.id,
          message: payload.message,
          images: payload.images,
          files: payload.files
        },
        signal
      )
    );
  }

  /** Widget 刷新后按 token + sessionId 恢复自己会话的消息，不能只凭 conversationId 读取。 */
  @Get("conversations/:conversationId/messages")
  async getMessages(
    @Param("conversationId") conversationId: string,
    @Query("agentToken") agentToken: string,
    @Query("sessionId") sessionId: string,
    @Query("limit") limit: string | undefined,
    @Req() request: IncomingMessage
  ) {
    this.rateLimiter.assertAllowed(
      "public-messages",
      `${agentToken}:${sessionId}:${this.getClientIp(request)}`,
      60
    );
    const agent = await this.externalAccessService.getPublicAgentProfile(agentToken);

    return this.externalAccessService.listConversationMessages(
      {
        agentId: agent.id,
        source: "WIDGET",
        externalId: sessionId,
        conversationId
      },
      limit
    );
  }

  /** 从受反向代理支持的 forwarded header 获取 IP，缺失时回退到直连 socket 地址。 */
  private getClientIp(request: IncomingMessage): string {
    const forwarded = request.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];

    return value?.trim() || request.socket.remoteAddress || "unknown";
  }
}

@Controller()
@Public()
@UseGuards(AgentApiKeyGuard)
export class ServiceApiController {
  constructor(
    private readonly externalAccessService: ExternalAccessService,
    private readonly rateLimiter: ExternalRateLimiterService
  ) {}

  @Post("chat-messages")
  /** Service API 的 Dify 风格对话入口：由 Guard 解析 Agent，body 不接受 agentId。 */
  async chat(
    @Body() payload: ServiceChatMessageDto,
    @Req() request: AgentApiKeyRequest,
    @Res() response: ServerResponse
  ): Promise<void> {
    const key = request.agentApiKey!;
    const user = payload.user?.trim() ?? "";
    this.rateLimiter.assertAllowed("service-chat", `${key.id}:${user}`, 60);
    const createStream = (signal?: AbortSignal) =>
      this.externalAccessService.streamMessage(
        {
          agentId: key.agentId,
          source: "SERVICE_API",
          externalId: user,
          conversationId: payload.conversation_id
        },
        {
          agentId: key.agentId,
          message: payload.query,
          images: payload.images,
          files: payload.files
        },
        signal
      );

    // v1.1 以 streaming 为默认实现；blocking 在同一编排器上收集 token 后返回，避免两套模型逻辑。
    if (payload.response_mode === "blocking") {
      const collected = await collectStream(createStream());
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ code: 200, message: "success", data: collected }));
      return;
    }

    await streamSse(request, response, createStream);
  }

  @Get("conversations")
  /** 只列出当前 API Key 对应 Agent 且当前 user 拥有的历史会话。 */
  async listConversations(
    @Query() query: ExternalConversationListQueryDto,
    @Req() request: AgentApiKeyRequest
  ) {
    return this.externalAccessService.listConversations(request.agentApiKey!.agentId, query.user ?? "", query.limit);
  }

  @Get("messages")
  /** 读取消息时由 ExternalAccessService 再次校验 conversation_id 的 user 归属。 */
  async listMessages(
    @Query("conversation_id") conversationId: string,
    @Query() query: ExternalConversationMessageQueryDto,
    @Req() request: AgentApiKeyRequest
  ) {
    return this.externalAccessService.listMessages(
      request.agentApiKey!.agentId,
      query.user ?? "",
      conversationId,
      query.limit
    );
  }
}

/** 统一公开 SSE 响应头、心跳和断开取消，避免外部接口与工作台 Chat 的行为不一致。 */
async function streamSse(
  request: IncomingMessage,
  response: ServerResponse,
  createStream: (signal: AbortSignal) => AsyncIterable<{ type: string; data: Record<string, unknown> }>
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.on("aborted", abort);
  response.on("close", abort);
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();
  const heartbeat = setInterval(() => {
    response.write("event: ping\n");
    response.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 15_000);

  try {
    for await (const event of createStream(controller.signal)) {
      if (controller.signal.aborted) {
        break;
      }

      response.write(`event: ${event.type}\n`);
      response.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (error) {
    response.write("event: error\n");
    response.write(
      `data: ${JSON.stringify({ message: error instanceof Error ? error.message : "对话失败" })}\n\n`
    );
  } finally {
    clearInterval(heartbeat);
    request.off("aborted", abort);
    response.off("close", abort);
    response.end();
  }
}

/** blocking 模式复用流式编排并收集 token，避免维护第二套模型和工具调用流程。 */
async function collectStream(stream: AsyncIterable<{ type: string; data: Record<string, unknown> }>) {
  let answer = "";
  let conversationId: string | null = null;

  for await (const event of stream) {
    if (event.type === "message_start") {
      conversationId = typeof event.data.conversationId === "string" ? event.data.conversationId : null;
    }

    if (event.type === "token") {
      answer += String(event.data.content ?? "");
    }

    if (event.type === "error") {
      throw new Error(String(event.data.message ?? "对话失败"));
    }
  }

  return {
    answer,
    conversation_id: conversationId
  };
}
