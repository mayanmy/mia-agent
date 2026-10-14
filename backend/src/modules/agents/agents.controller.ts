import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { CurrentWorkspace } from "../../core/auth/current-workspace.decorator";
import { Public } from "../../core/auth/public.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired, WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { PageResult } from "../../core/result";
import { CurrentUserDto } from "../users/dto/user.dto";
import { CurrentWorkspaceDto } from "../workspaces/dto/workspace.dto";
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
  AgentSkillBindingDto,
  AgentSkillBindingResult,
  AgentUpdateDto,
  AgentWorkflowBindingDto,
  AgentWorkflowBindingResult
} from "./dto/agent.dto";
import { AgentsService } from "./agents.service";

@Controller("agents")
@WorkspaceRequired()
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /** 按权限返回 Agent 管理或成员可用列表。 */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRequired()
  async listAgents(
    @Query() query: AgentQueryDto,
    @CurrentUser() currentUser: CurrentUserDto,
    @CurrentWorkspace() currentWorkspace: CurrentWorkspaceDto
  ): Promise<PageResult<AgentListItem>> {
    return this.agentsService.listAgents(query, currentUser, currentWorkspace);
  }

  /** 创建 Agent 基础配置。 */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async createAgent(@Body() payload: AgentCreateDto): Promise<AgentDetail> {
    return this.agentsService.createAgent(payload);
  }

  @Get("shared/:token")
  /** 无需登录的分享页元数据入口。 */
  @Public()
  async getSharedAgent(@Param("token") token: string): Promise<SharedAgentDetail> {
    return this.agentsService.getSharedAgent(token);
  }

  /** 获取 Agent 编辑详情。 */
  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getAgent(@Param("id") id: string): Promise<AgentDetail> {
    return this.agentsService.getAgent(id);
  }

  /** 更新 Agent 基础配置。 */
  @Put(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateAgent(
    @Param("id") id: string,
    @Body() payload: AgentUpdateDto
  ): Promise<AgentDetail> {
    return this.agentsService.updateAgent(id, payload);
  }

  /** 软删除 Agent。 */
  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async deleteAgent(@Param("id") id: string): Promise<null> {
    await this.agentsService.deleteAgent(id);
    return null;
  }

  /** 发布 Agent 并返回分享令牌。 */
  @Post(":id/publish")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async publishAgent(@Param("id") id: string): Promise<AgentPublishResult> {
    return this.agentsService.publishAgent(id);
  }

  /** 取消发布并作废分享入口。 */
  @Delete(":id/publish")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async unpublishAgent(@Param("id") id: string): Promise<AgentPublishResult> {
    return this.agentsService.unpublishAgent(id);
  }

  /** 获取 Agent 工具绑定。 */
  @Get(":id/tools")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getAgentTools(@Param("id") id: string): Promise<AgentToolBindingResult> {
    return this.agentsService.getAgentTools(id);
  }

  /** 批量替换 Agent 工具绑定。 */
  @Put(":id/tools")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateAgentTools(
    @Param("id") id: string,
    @Body() payload: AgentToolBindingDto
  ): Promise<AgentToolBindingResult> {
    return this.agentsService.updateAgentTools(id, payload);
  }

  /** 获取 Agent 的有序 Skill 绑定。 */
  @Get(":id/skills")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getAgentSkills(@Param("id") id: string): Promise<AgentSkillBindingResult> {
    return this.agentsService.getAgentSkills(id);
  }

  /** 原子替换 Agent 的有序 Skill 绑定。 */
  @Put(":id/skills")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateAgentSkills(
    @Param("id") id: string,
    @Body() payload: AgentSkillBindingDto
  ): Promise<AgentSkillBindingResult> {
    return this.agentsService.updateAgentSkills(id, payload);
  }

  /** 获取 Agent 知识库绑定。 */
  @Get(":id/knowledge-bases")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getAgentKnowledgeBases(@Param("id") id: string): Promise<AgentKnowledgeBaseBindingResult> {
    return this.agentsService.getAgentKnowledgeBases(id);
  }

  /** 批量替换 Agent 知识库绑定。 */
  @Put(":id/knowledge-bases")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateAgentKnowledgeBases(
    @Param("id") id: string,
    @Body() payload: AgentKnowledgeBaseBindingDto
  ): Promise<AgentKnowledgeBaseBindingResult> {
    return this.agentsService.updateAgentKnowledgeBases(id, payload);
  }

  /** 获取 Agent 工作流执行策略。 */
  @Get(":id/workflow")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getAgentWorkflow(@Param("id") id: string): Promise<AgentWorkflowBindingResult> {
    return this.agentsService.getAgentWorkflow(id);
  }

  /** 更新 Agent 工作流执行策略。 */
  @Put(":id/workflow")
  @Roles(UserRole.ADMIN, UserRole.USER)
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateAgentWorkflow(
    @Param("id") id: string,
    @Body() payload: AgentWorkflowBindingDto
  ): Promise<AgentWorkflowBindingResult> {
    return this.agentsService.updateAgentWorkflow(id, payload);
  }
}
