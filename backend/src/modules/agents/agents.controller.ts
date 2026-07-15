import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Public } from "../../core/auth/public.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { PageResult } from "../../core/result";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  AgentCreateDto,
  AgentDetail,
  AgentKnowledgeBaseBindingDto,
  AgentKnowledgeBaseBindingResult,
  AgentListItem,
  AgentPublishResult,
  AgentQueryDto,
  SharedAgentDetail,
  AgentToolBindingDto,
  AgentToolBindingResult,
  AgentUpdateDto
} from "./dto/agent.dto";
import { AgentsService } from "./agents.service";

@Controller("agents")
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.USER)
  async listAgents(
    @Query() query: AgentQueryDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<PageResult<AgentListItem>> {
    return this.agentsService.listAgents(query, currentUser);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.USER)
  async createAgent(@Body() payload: AgentCreateDto): Promise<AgentDetail> {
    return this.agentsService.createAgent(payload);
  }

  @Get("shared/:token")
  @Public()
  async getSharedAgent(@Param("token") token: string): Promise<SharedAgentDetail> {
    return this.agentsService.getSharedAgent(token);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async getAgent(@Param("id") id: string): Promise<AgentDetail> {
    return this.agentsService.getAgent(id);
  }

  @Put(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async updateAgent(
    @Param("id") id: string,
    @Body() payload: AgentUpdateDto
  ): Promise<AgentDetail> {
    return this.agentsService.updateAgent(id, payload);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async deleteAgent(@Param("id") id: string): Promise<null> {
    await this.agentsService.deleteAgent(id);
    return null;
  }

  @Post(":id/publish")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async publishAgent(@Param("id") id: string): Promise<AgentPublishResult> {
    return this.agentsService.publishAgent(id);
  }

  @Delete(":id/publish")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async unpublishAgent(@Param("id") id: string): Promise<AgentPublishResult> {
    return this.agentsService.unpublishAgent(id);
  }

  @Get(":id/tools")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async getAgentTools(@Param("id") id: string): Promise<AgentToolBindingResult> {
    return this.agentsService.getAgentTools(id);
  }

  @Put(":id/tools")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async updateAgentTools(
    @Param("id") id: string,
    @Body() payload: AgentToolBindingDto
  ): Promise<AgentToolBindingResult> {
    return this.agentsService.updateAgentTools(id, payload);
  }

  @Get(":id/knowledge-bases")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async getAgentKnowledgeBases(@Param("id") id: string): Promise<AgentKnowledgeBaseBindingResult> {
    return this.agentsService.getAgentKnowledgeBases(id);
  }

  @Put(":id/knowledge-bases")
  @Roles(UserRole.ADMIN, UserRole.USER)
  async updateAgentKnowledgeBases(
    @Param("id") id: string,
    @Body() payload: AgentKnowledgeBaseBindingDto
  ): Promise<AgentKnowledgeBaseBindingResult> {
    return this.agentsService.updateAgentKnowledgeBases(id, payload);
  }
}
