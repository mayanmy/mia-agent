import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { UserManagementController } from "./user-management.controller";

@Module({
  imports: [UsersModule],
  // 平台账号与空间成员是两条独立生命周期：只有全局 ADMIN 可以使用账号管理接口。
  controllers: [AuthController, UserManagementController],
  providers: [AuthService, PasswordService, TokenService],
  // 外部公开访问的密码门禁复用同一套强度校验和 Argon2 配置，避免两处密码策略漂移。
  exports: [AuthService, PasswordService, TokenService]
})
export class AuthModule {}
