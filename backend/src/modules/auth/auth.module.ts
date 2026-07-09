import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { UserManagementController } from "./user-management.controller";

@Module({
  imports: [UsersModule],
  controllers: [AuthController, UserManagementController],
  providers: [AuthService, PasswordService, TokenService],
  exports: [AuthService, TokenService]
})
export class AuthModule {}
