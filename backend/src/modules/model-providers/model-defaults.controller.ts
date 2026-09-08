import { Body, Controller, Get, Put } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { DefaultModelSettings, DefaultModelSettingsUpdateDto } from "./dto/model-provider.dto";
import { ModelProvidersService } from "./model-providers.service";

@Controller("model-defaults")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class ModelDefaultsController {
  constructor(private readonly modelProvidersService: ModelProvidersService) {}

  @Get()
  async getDefaultModelSettings(): Promise<DefaultModelSettings> {
    return this.modelProvidersService.getDefaultModelSettings();
  }

  @Put()
  async updateDefaultModelSettings(
    @Body() payload: DefaultModelSettingsUpdateDto
  ): Promise<DefaultModelSettings> {
    return this.modelProvidersService.updateDefaultModelSettings(payload);
  }
}
