import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  McpConnectionTestResult,
  McpServerCreateDto,
  McpServerDetail,
  McpServerListItem,
  McpServerToolDetail,
  McpServerToolUpdateDto,
  McpServerUpdateDto,
  McpSyncResult,
  McpSyncRunListItem
} from "./dto/mcp-server.dto";
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

  @Post(":id/sync-tools")
  async syncTools(@Param("id") id: string): Promise<McpSyncResult> {
    return this.mcpService.syncTools(id);
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
