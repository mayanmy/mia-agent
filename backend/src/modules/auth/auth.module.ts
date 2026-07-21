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
  // 外部公开访问的密码门禁复用同一套强度校验和 Argon2 配置，避免两处密码策略漂移。
  exports: [AuthService, PasswordService, TokenService]
})
export class AuthModule {}
