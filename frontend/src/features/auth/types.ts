/** 前端可识别的基础角色；权限判断仍以服务端为准。 */
export type UserRole = "ADMIN" | "USER";

/** 当前登录成员的安全摘要，不包含密码或 Refresh Token。 */
export type CurrentUser = {
  /** 用户 ID。 */
  id: string;
  /** 登录邮箱。 */
  email: string;
  /** 页面展示名称。 */
  displayName: string;
  /** 用于菜单和操作入口展示的角色。 */
  role: UserRole;
};

/** 登录和刷新接口返回的短期访问凭证。 */
export type AuthResponse = {
  /** 仅保存在内存中的短期 Access Token。 */
  accessToken: string;
  /** Access Token 剩余有效秒数。 */
  expiresInSeconds: number;
  /** 当前成员资料。 */
  user: CurrentUser;
};
