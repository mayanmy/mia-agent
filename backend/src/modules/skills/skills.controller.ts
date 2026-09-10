import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRoles } from "../../core/auth/workspace.decorator";
import type { PageResult } from "../../core/result";
import type { CurrentUserDto } from "../users/dto/user.dto";
import type {
  SkillCreateDto,
  SkillDetail,
  SkillQueryDto,
  SkillStatusDto,
  SkillUpdateDto
} from "./dto/skill.dto";
import { SkillsService } from "./skills.service";

@Controller("skills")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  list(@Query() query: SkillQueryDto): Promise<PageResult<SkillDetail>> {
    return this.skillsService.listSkills(query);
  }

  @Post()
  create(
    @Body() payload: SkillCreateDto,
    @CurrentUser() user: CurrentUserDto
  ): Promise<SkillDetail> {
    return this.skillsService.createSkill(payload, user.id);
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<SkillDetail> {
    return this.skillsService.getSkill(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() payload: SkillUpdateDto): Promise<SkillDetail> {
    return this.skillsService.updateSkill(id, payload);
  }

  @Patch(":id/status")
  status(@Param("id") id: string, @Body() payload: SkillStatusDto): Promise<SkillDetail> {
    return this.skillsService.updateStatus(id, payload);
  }

  @Delete(":id")
  async archive(@Param("id") id: string): Promise<null> {
    await this.skillsService.archiveSkill(id);
    return null;
  }
}
