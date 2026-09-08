import { request } from "../../shared/api/client";
import type {
  WorkspaceInvitation,
  WorkspaceListItem,
  WorkspaceMember,
  WorkspaceRole
} from "./types";

/** 返回当前账号加入的全部有效项目空间。 */
export function listWorkspaces(): Promise<WorkspaceListItem[]> {
  return request("/api/v1/workspaces", { dedupe: false });
}

/** 创建项目空间，当前账号自动成为 OWNER。 */
export function createWorkspace(payload: {
  name: string;
  description?: string;
}): Promise<WorkspaceListItem> {
  return request("/api/v1/workspaces", { method: "POST", body: JSON.stringify(payload) });
}

/** 更新当前项目空间资料。 */
export function updateWorkspace(
  workspaceId: string,
  payload: { name: string; description?: string }
): Promise<WorkspaceListItem> {
  return request(`/api/v1/workspaces/${workspaceId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

/** 返回当前项目空间成员。 */
export function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return request(`/api/v1/workspaces/${workspaceId}/members`, { dedupe: false });
}

/** 邀请已有或新用户加入当前项目空间。 */
export function createWorkspaceInvitation(
  workspaceId: string,
  payload: { email: string; displayName: string; role: Exclude<WorkspaceRole, "OWNER"> }
): Promise<WorkspaceInvitation> {
  return request(`/api/v1/workspaces/${workspaceId}/invitations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/** 修改空间成员角色。 */
export function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, "OWNER">
): Promise<null> {
  return request(`/api/v1/workspaces/${workspaceId}/members/${userId}/role`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
}

/** 从当前项目空间移除成员，不影响其全局账号。 */
export function removeWorkspaceMember(workspaceId: string, userId: string): Promise<null> {
  return request(`/api/v1/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
}

/** 转让项目空间所有权。 */
export function transferWorkspaceOwnership(workspaceId: string, userId: string): Promise<null> {
  return request(`/api/v1/workspaces/${workspaceId}/transfer-ownership`, {
    method: "POST",
    body: JSON.stringify({ userId })
  });
}
