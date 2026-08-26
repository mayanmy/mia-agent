import { Controller, Param, Post } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import { McpToolApprovalDetail } from "./dto/mcp-approval.dto";
import { McpApprovalService } from "./mcp-approval.service";

@Controller("mcp/approvals")
@Roles(UserRole.ADMIN, UserRole.USER)
export class McpApprovalsController {
  constructor(private readonly approvals: McpApprovalService) {}

  @Post(":id/approve")
  async approve(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpToolApprovalDetail> {
    return this.approvals.approve(id, currentUser.id);
  }

  @Post(":id/reject")
  async reject(
    @Param("id") id: string,
    @CurrentUser() currentUser: CurrentUserDto
  ): Promise<McpToolApprovalDetail> {
    return this.approvals.reject(id, currentUser.id);
  }
}
