import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import { PageResult } from '../../core/result';
import {
  AgentCreateDto,
  AgentDetail,
  AgentListItem,
  AgentQueryDto,
  AgentToolBindingDto,
  AgentToolBindingResult,
  AgentUpdateDto,
} from './dto/agent.dto';
import { AgentsService } from './agents.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  async listAgents(@Query() query: AgentQueryDto): Promise<PageResult<AgentListItem>> {
    return this.agentsService.listAgents(query);
  }

  @Post()
  async createAgent(@Body() payload: AgentCreateDto): Promise<AgentDetail> {
    return this.agentsService.createAgent(payload);
  }

  @Get(':id')
  async getAgent(@Param('id') id: string): Promise<AgentDetail> {
    return this.agentsService.getAgent(id);
  }

  @Put(':id')
  async updateAgent(
    @Param('id') id: string,
    @Body() payload: AgentUpdateDto,
  ): Promise<AgentDetail> {
    return this.agentsService.updateAgent(id, payload);
  }

  @Delete(':id')
  async deleteAgent(@Param('id') id: string): Promise<null> {
    await this.agentsService.deleteAgent(id);
    return null;
  }

  @Get(':id/tools')
  async getAgentTools(@Param('id') id: string): Promise<AgentToolBindingResult> {
    return this.agentsService.getAgentTools(id);
  }

  @Put(':id/tools')
  async updateAgentTools(
    @Param('id') id: string,
    @Body() payload: AgentToolBindingDto,
  ): Promise<AgentToolBindingResult> {
    return this.agentsService.updateAgentTools(id, payload);
  }
}
