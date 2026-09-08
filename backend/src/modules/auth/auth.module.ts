import { Module } from "@nestjs/common";

import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  imports: [UsersModule],
  // 全局用户管理入口不再注册；成员生命周期统一由项目空间接口管理，避免枚举其他空间账户。
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  // 外部公开访问的密码门禁复用同一套强度校验和 Argon2 配置，避免两处密码策略漂移。
  exports: [AuthService, PasswordService, TokenService]
})
export class AuthModule {}
