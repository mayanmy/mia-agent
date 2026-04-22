import { Body, Controller, Post } from '@nestjs/common';

import { ChatService } from './chat.service';
import { ChatCompletionDto, ChatCompletionResult } from './dto/chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('completions')
  async createCompletion(@Body() payload: ChatCompletionDto): Promise<ChatCompletionResult> {
    return this.chatService.createCompletion(payload);
  }
}
