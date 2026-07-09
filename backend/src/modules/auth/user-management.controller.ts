import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { PageResult } from "../../core/result";
import {
  CreateManagedUserDto,
  CurrentUserDto,
  ResetUserPasswordDto,
  UpdateManagedUserDto,
  UserListItem,
  UserQueryDto
} from "../users/dto/user.dto";
import { AuthService } from "./auth.service";

/** 成员管理接口统一由认证编排层处理，所有操作仅管理员可访问。 */
@Controller("users")
@Roles(UserRole.ADMIN)
export class UserManagementController {
  constructor(private readonly authService: AuthService) {}

  /** 分页返回成员公开资料，不返回密码哈希、Refresh Token 或会话来源信息。 */
  @Get()
  listUsers(@Query() query: UserQueryDto): Promise<PageResult<UserListItem>> {
    return this.authService.listManagedUsers(query);
  }

  /** 创建成员并使用受控密码服务写入 Argon2id 哈希。 */
  @Post()
  createUser(@Body() payload: CreateManagedUserDto): Promise<CurrentUserDto> {
    return this.authService.createManagedUser(payload);
  }

  /** 修改成员展示名、角色或启用状态；禁用后服务端会撤销其全部 Refresh Session。 */
  @Patch(":id")
  updateUser(
    @Param("id") id: string,
    @Body() payload: UpdateManagedUserDto
  ): Promise<UserListItem> {
    return this.authService.updateManagedUser(id, payload);
  }

  /** 重置密码并使目标用户全部设备重新登录。 */
  @Post(":id/reset-password")
  async resetPassword(
    @Param("id") id: string,
    @Body() payload: ResetUserPasswordDto
  ): Promise<null> {
    await this.authService.resetManagedUserPassword(id, payload);
    return null;
  }

  /** 主动撤销成员全部 Refresh Session，不修改密码和账号状态。 */
  @Post(":id/revoke-sessions")
  async revokeSessions(@Param("id") id: string): Promise<null> {
    await this.authService.revokeManagedUserSessions(id);
    return null;
  }
}
