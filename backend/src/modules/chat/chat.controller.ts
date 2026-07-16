import { Body, Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import { IncomingMessage, ServerResponse } from "node:http";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import { ChatService } from "./chat.service";
import { ChatCompletionDto, ChatCompletionResult, ChatSessionResponse } from "./dto/chat.dto";

@Controller("chat")
@Roles(UserRole.ADMIN, UserRole.USER)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("completions")
  async createCompletion(
    @Body() payload: ChatCompletionDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<ChatCompletionResult> {
    return this.chatService.createCompletion(payload, { userId: currentUser.id });
  }

  @Get("sessions/:agentId")
  async getSession(
    @Param("agentId") agentId: string,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<ChatSessionResponse> {
    return this.chatService.getSession(agentId, { userId: currentUser.id });
  }

  @Post("stream")
  async streamCompletion(
    @Body() payload: ChatCompletionDto,
    @CurrentUser() currentUser: CurrentUserDto,
    @Req() request: IncomingMessage,
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
