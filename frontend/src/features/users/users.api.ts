import { request, type PageResult } from "../../shared/api/client";
import type { CurrentUser, UserRole } from "../auth/types";

/** 成员管理列表中的状态与时间摘要。 */
export type ManagedUser = CurrentUser & {
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};
/** 管理员直接创建成员的输入。 */
export type CreateManagedUserPayload = {
  email: string;
  displayName: string;
  password: string;
  role: UserRole;
};
/** 管理员更新成员资料、角色和启用状态的输入。 */
export type UpdateManagedUserPayload = { displayName?: string; role?: UserRole; enabled?: boolean };
/** 创建一次性成员邀请的输入。 */
export type CreateUserInvitationPayload = {
  email: string;
  displayName: string;
  role: UserRole;
};
/** 创建或重新生成后唯一一次返回的激活链接。 */
export type UserInvitation = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  activateUrl: string;
  expiresAt: string;
};

/** 查询成员管理列表，关键词在后端按邮箱与名称模糊匹配。 */
export function listUsers(page = 1, pageSize = 20, keyword = ""): Promise<PageResult<ManagedUser>> {
  const search = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (keyword.trim()) search.set("keyword", keyword.trim());
  return request<PageResult<ManagedUser>>(`/api/v1/users?${search.toString()}`);
}

/** 创建团队成员，密码只在本次请求中传输，不在前端保存。 */
export function createUser(payload: CreateManagedUserPayload): Promise<CurrentUser> {
  return request<CurrentUser>("/api/v1/users", { method: "POST", body: JSON.stringify(payload) });
}

/** 生成一次性成员激活链接；原始 Token 只会在这次响应中返回。 */
export function createUserInvitation(
  payload: CreateUserInvitationPayload
): Promise<UserInvitation> {
  return request<UserInvitation>("/api/v1/users/invitations", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/** 更新成员角色、名称或启用状态。 */
export function updateUser(id: string, payload: UpdateManagedUserPayload): Promise<ManagedUser> {
  return request<ManagedUser>(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

/** 重置成员密码后，后端会撤销目标成员全部会话。 */
export function resetPassword(id: string, password: string): Promise<null> {
  return request<null>(`/api/v1/users/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

/** 主动让成员在全部设备重新登录。 */
export function revokeSessions(id: string): Promise<null> {
  return request<null>(`/api/v1/users/${id}/revoke-sessions`, { method: "POST" });
}
