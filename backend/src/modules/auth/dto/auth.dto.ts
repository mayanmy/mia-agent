import { UserRole, WorkspaceRole } from "@prisma/client";

/** 登录接口接收的最小凭证，不允许附带角色或用户 ID。 */
export type LoginDto = {
  email?: string;
  password?: string;
};

/** 从 HTTP 请求提取的会话来源信息，只用于安全排查，不参与身份判断。 */
export type AuthRequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

/** Access Token 中的稳定声明，Guard 只信任签名验证后的内容。 */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
};

/** 返回给前端的短期登录态；长期 Refresh Token 始终通过 HttpOnly Cookie 下发。 */
export type AuthResponse = {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
  };
};

/** Controller 写入 Cookie 前所需的 Refresh Token 和过期时间。 */
export type AuthSessionResponse = AuthResponse & {
  refreshToken: string;
  refreshExpiresAt: Date;
};

/** 公开激活页展示的非敏感邀请资料，不返回令牌哈希或管理员信息。 */
export type InvitationValidationResponse = {
  displayName: string;
  email: string;
  expiresAt: Date;
  workspaceName: string;
  role: WorkspaceRole;
};

/** 成员使用一次性链接设置首个密码的公开请求。 */
export type AcceptUserInvitationDto = {
  token?: string;
  password?: string;
};
