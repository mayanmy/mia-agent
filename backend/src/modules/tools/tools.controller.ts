import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired, WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { CurrentUser } from "../../core/auth/current-user.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import { ConfiguredHttpToolsService } from "./configured-http-tools.service";
import {
  HttpToolCreateDto,
  HttpToolDetail,
  HttpToolListItem,
  HttpToolTestDto,
  HttpToolTestResult,
  HttpToolUpdateDto
} from "./dto/http-tool.dto";
import { ToolListItem } from "./dto/tool.dto";
import { ToolsService } from "./tools.service";

@Controller("tools")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRequired()
export class ToolsController {
  constructor(
    private readonly toolsService: ToolsService,
    private readonly configuredHttpTools: ConfiguredHttpToolsService
  ) {}

  /** 返回 Agent 可绑定的全部工具，普通成员也需要读取。 */
  @Get()
  async listTools(): Promise<ToolListItem[]> {
    return this.toolsService.listTools();
  }

  /** HTTP 工具配置属于管理员运维面。 */
  @Get("http")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async listHttpTools(): Promise<HttpToolListItem[]> {
    return this.configuredHttpTools.listHttpTools();
  }

  /** 创建时使用当前管理员作为工具和凭据审计主体。 */
  @Post("http")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async createHttpTool(
    @Body() payload: HttpToolCreateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<HttpToolDetail> {
    return this.configuredHttpTools.createHttpTool(payload, currentUser.id);
  }

  /** 详情只回显非敏感配置。 */
  @Get("http/:id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async getHttpTool(@Param("id") id: string): Promise<HttpToolDetail> {
    return this.configuredHttpTools.getHttpTool(id);
  }

  /** 更新凭据时允许留空以保留原 Secret。 */
  @Put("http/:id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async updateHttpTool(
    @Param("id") id: string,
    @Body() payload: HttpToolUpdateDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<HttpToolDetail> {
    return this.configuredHttpTools.updateHttpTool(id, payload, currentUser.id);
  }

  /** 删除使用软删除，保留历史 Run Trace 的工具标识。 */
  @Delete("http/:id")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async deleteHttpTool(@Param("id") id: string): Promise<null> {
    await this.configuredHttpTools.deleteHttpTool(id);
    return null;
  }

  /** 测试调用复用正式 Executor，确保安全策略和 Runtime 一致。 */
  @Post("http/:id/test")
  @WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER, WorkspaceRole.MEMBER)
  async testHttpTool(
    @Param("id") id: string,
    @Body() payload: HttpToolTestDto,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<HttpToolTestResult> {
    // Runtime 执行入口本身允许已绑定工具调用，管理端测试前必须额外验证资源创建者权限。
    await this.configuredHttpTools.getHttpTool(id);
    const result = await this.toolsService.executeTool({
      toolId: `http_${id}`,
      input: payload.input ?? {},
      userId: currentUser.id
    });
    return {
      ok: result.ok,
      output: result.output,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      elapsedMs: result.elapsedMs
    };
  }
}
