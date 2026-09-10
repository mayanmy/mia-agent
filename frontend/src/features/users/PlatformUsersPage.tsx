import { AccountManagementPanel } from "./components/AccountManagementPanel";

/** 平台账号管理与项目空间无关，只由全局 ADMIN 角色授权。 */
export function PlatformUsersPage() {
  return <AccountManagementPanel />;
}
