import { Body, Controller, Delete, Get, Param, Post, Put, Query, Redirect } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Public } from "../../core/auth/public.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { getConfig } from "../../core/config";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  McpConnectionTestResult,
  McpOAuthStartResponse,
  McpServerCreateDto,
  McpServerDetail,
  McpServerListItem,
  McpServerToolDetail,
  McpServerToolUpdateDto,
  McpServerUpdateDto,
  McpSyncResult,
  McpSyncRunListItem
} from "./dto/mcp-server.dto";
import {
  McpResourceCatalog,
  McpResourceImportDto,
  McpResourceImportResult,
  McpResourcePreview,
  McpResourceReadDto
} from "./dto/mcp-resource.dto";
import {
  McpPromptCatalog,
  McpPromptGetDto,
  McpPromptImportDto,
  McpPromptImportResult,
  McpPromptPreview
} from "./dto/mcp-prompt.dto";
import { McpService } from "./mcp.service";

@Controller("mcp/servers")
@Roles(UserRole.ADMIN)
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get()
  async listServers(): Promise<McpServerListItem[]> {
    return this.mcpService.listServers();
  }

  @Post()
  async createServer(
    @Body() payload: McpServerCreateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpServerDetail> {
    return this.mcpService.createServer(payload, currentUser.id);
  }

  /** OAuth 回调依靠一次性 state 鉴别请求，不能要求第三方授权服务器携带 Mia JWT。 */
  @Get("oauth/callback")
  @Public()
  @Redirect()
  async completeOAuth(
    @Query("state") state: string,
    @Query("code") code?: string,
    @Query("iss") iss?: string,
    @Query("error") error?: string
  ): Promise<{ url: string; statusCode: number }> {
    const serverId = await this.mcpService.completeOAuthAuthorization({ state, code, iss, error });
    const url = new URL("/mcp", getConfig().publicBaseUrl);
    url.searchParams.set("oauth", "success");
    url.searchParams.set("serverId", serverId);
    return { url: url.toString(), statusCode: 302 };
  }

  @Get(":id")
  async getServer(@Param("id") id: string): Promise<McpServerDetail> {
    return this.mcpService.getServer(id);
  }

  @Put(":id")
  async updateServer(
    @Param("id") id: string,
    @Body() payload: McpServerUpdateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpServerDetail> {
    return this.mcpService.updateServer(id, payload, currentUser.id);
  }

  @Delete(":id")
  async deleteServer(@Param("id") id: string): Promise<null> {
    await this.mcpService.deleteServer(id);
    return null;
  }

  /** 连接测试不会覆盖工具快照，适合管理员在保存配置后先验证网络和鉴权。 */
  @Post(":id/test")
  async testConnection(@Param("id") id: string): Promise<McpConnectionTestResult> {
    return this.mcpService.testConnection(id);
  }

  @Post(":id/oauth/authorize")
  async startOAuth(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpOAuthStartResponse> {
    return this.mcpService.startOAuthAuthorization(id, currentUser.id);
  }

  @Delete(":id/oauth/authorization")
  async revokeOAuth(@Param("id") id: string): Promise<null> {
    await this.mcpService.revokeOAuthAuthorization(id);
    return null;
  }

  @Post(":id/sync-tools")
  async syncTools(@Param("id") id: string): Promise<McpSyncResult> {
    return this.mcpService.syncTools(id);
  }

  /** Resource 目录始终实时读取远端，只把协议元数据返回给管理员。 */
  @Get(":id/resources")
  async listResources(@Param("id") id: string): Promise<McpResourceCatalog> {
    return this.mcpService.listResources(id);
  }

  @Post(":id/resources/preview")
  async previewResource(
    @Param("id") id: string,
    @Body() payload: McpResourceReadDto
  ): Promise<McpResourcePreview> {
    return this.mcpService.previewResource(id, payload);
  }

  /** 只有管理员显式选择知识库后才允许导入，不提供 MCP Server 主动写入入口。 */
  @Post(":id/resources/import")
  async importResource(
    @Param("id") id: string,
    @Body() payload: McpResourceImportDto
  ): Promise<McpResourceImportResult> {
    return this.mcpService.importResource(id, payload);
  }

  @Get(":id/prompts")
  async listPrompts(@Param("id") id: string): Promise<McpPromptCatalog> {
    return this.mcpService.listPrompts(id);
  }

  @Post(":id/prompts/preview")
  async previewPrompt(
    @Param("id") id: string,
    @Body() payload: McpPromptGetDto
  ): Promise<McpPromptPreview> {
    return this.mcpService.previewPrompt(id, payload);
  }

  /** 导入需要记录当前管理员，并始终创建停用 Skill 草稿。 */
  @Post(":id/prompts/import")
  async importPrompt(
    @Param("id") id: string,
    @Body() payload: McpPromptImportDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpPromptImportResult> {
    return this.mcpService.importPrompt(id, payload, currentUser.id);
  }

  @Get(":id/tools")
  async listTools(@Param("id") id: string): Promise<McpServerToolDetail[]> {
    return this.mcpService.listTools(id);
  }

  @Put(":id/tools/:toolId")
  async updateTool(
    @Param("id") id: string,
    @Param("toolId") toolId: string,
    @Body() payload: McpServerToolUpdateDto
  ): Promise<McpServerToolDetail> {
    return this.mcpService.updateTool(id, toolId, payload);
  }

  @Get(":id/sync-runs")
  async listSyncRuns(@Param("id") id: string): Promise<McpSyncRunListItem[]> {
    return this.mcpService.listSyncRuns(id);
  }
}
