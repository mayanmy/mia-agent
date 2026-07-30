import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import { IncomingMessage, ServerResponse } from "node:http";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import { RequestWithId } from "../../core/request-id.middleware";
import { ChatService } from "./chat.service";
import { ChatCompletionDto, ChatCompletionResult } from "./dto/chat.dto";
import {
  ChatMessageQueryDto,
  ChatSessionListQueryDto,
  CreateChatSessionDto,
  UpdateChatSessionDto
} from "./dto/chat-session.dto";

@Controller("chat")
@Roles(UserRole.ADMIN, UserRole.USER)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** 非流式对话入口，透传当前用户与 requestId 给编排层。 */
  @Post("completions")
  async createCompletion(
    @Body() payload: ChatCompletionDto,
    @CurrentUser() currentUser: CurrentUserDto,
    @Req() request: IncomingMessage & RequestWithId
  ): Promise<ChatCompletionResult> {
    return this.chatService.createCompletion(payload, {
      requestId: request.requestId,
      userId: currentUser.id
    });
  }

  /** 查询当前用户在指定 Agent 下的会话。 */
  @Get("sessions")
  async listSessions(
    @Query() query: ChatSessionListQueryDto,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.listSessions(query, { userId: currentUser.id });
  }

  /** 创建新的独立持久会话。 */
  @Post("sessions")
  async createSession(
    @Body() payload: CreateChatSessionDto,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.createSession(payload, { userId: currentUser.id });
  }

  /** 兼容旧前端的单会话读取入口。 */
  @Get("sessions/:agentId")
  async getLegacySession(
    @Param("agentId") agentId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.getSession(agentId, { userId: currentUser.id });
  }

  /** 分页读取指定会话的历史消息。 */
  @Get("sessions/:sessionId/messages")
  async getSessionMessages(
    @Param("sessionId") sessionId: string,
    @Query() query: ChatMessageQueryDto,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.getSessionMessages(sessionId, query, { userId: currentUser.id });
  }

  /** 更新会话标题。 */
  @Patch("sessions/:sessionId")
  async updateSession(
    @Param("sessionId") sessionId: string,
    @Body() payload: UpdateChatSessionDto,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.updateSession(sessionId, payload, { userId: currentUser.id });
  }

  /** 将会话归档为只读状态。 */
  @Post("sessions/:sessionId/archive")
  async archiveSession(
    @Param("sessionId") sessionId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.archiveSession(sessionId, { userId: currentUser.id });
  }

  /** 恢复归档会话。 */
  @Post("sessions/:sessionId/restore")
  async restoreSession(
    @Param("sessionId") sessionId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ) {
    return this.chatService.restoreSession(sessionId, { userId: currentUser.id });
  }

  /** 永久删除归档会话及其消息；Controller 只传递当前用户，归属校验由 Service 完成。 */
  @Delete("sessions/:sessionId")
  async deleteSession(
    @Param("sessionId") sessionId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<null> {
    await this.chatService.deleteSession(sessionId, { userId: currentUser.id });
    return null;
  }

  /**
   * 建立 SSE 响应并把客户端断开转换为 AbortSignal。
   * 心跳用于穿透反向代理空闲超时，事件内容由 ChatService 统一定义。
   */
  @Post("stream")
  async streamCompletion(
    @Body() payload: ChatCompletionDto,
    @CurrentUser() currentUser: CurrentUserDto,
    @Req() request: IncomingMessage & RequestWithId,
    @Res() response: ServerResponse
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
    }, 15000);

    try {
      for await (const event of this.chatService.streamCompletion(payload, controller.signal, {
        requestId: request.requestId,
        userId: currentUser.id
      })) {
        response.write(`event: ${event.type}\n`);
        response.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (error) {
      response.write("event: error\n");
      response.write(
        `data: ${JSON.stringify({
          message: error instanceof Error ? error.message : "chat stream failed"
        })}\n\n`
      );
    } finally {
      clearInterval(heartbeat);
      request.off("aborted", abort);
      response.off("close", abort);
      response.end();
    }
  }
}
