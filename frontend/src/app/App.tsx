import { lazy, Suspense } from "react";
import { Button, Dropdown, Spin } from "antd";
import {
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";

import { useAuth } from "../features/auth/AuthProvider";
import { LoginPage } from "../features/auth/LoginPage";
import type { UserRole } from "../features/auth/types";

const AgentsPage = lazy(() =>
  import("../features/agents/AgentsPage").then((module) => ({ default: module.AgentsPage }))
);
const SharedAgentPage = lazy(() =>
  import("../features/agents/SharedAgentPage").then((module) => ({
    default: module.SharedAgentPage
  }))
);
const ChatPage = lazy(() =>
  import("../features/chat/ChatPage").then((module) => ({ default: module.ChatPage }))
);
const ProvidersPage = lazy(() =>
  import("../features/model-providers/ProvidersPage").then((module) => ({
    default: module.ProvidersPage
  }))
);
const HealthPage = lazy(() =>
  import("../pages/HealthPage").then((module) => ({ default: module.HealthPage }))
);
const LogsPage = lazy(() =>
  import("../features/logs/LogsPage").then((module) => ({ default: module.LogsPage }))
);
const KnowledgePage = lazy(() =>
  import("../features/knowledge/KnowledgePage").then((module) => ({
    default: module.KnowledgePage
  }))
);
const UsersPage = lazy(() =>
  import("../features/users/UsersPage").then((module) => ({ default: module.UsersPage }))
);
const ActivateInvitationPage = lazy(() =>
  import("../features/auth/ActivateInvitationPage").then((module) => ({
    default: module.ActivateInvitationPage
  }))
);

type NavConfig = {
  label: string;
  path: string;
  roles: UserRole[];
};

const navConfig: NavConfig[] = [
  { label: "模型供应商", path: "/providers", roles: ["ADMIN"] },
  { label: "Agent", path: "/agents", roles: ["ADMIN"] },
  { label: "知识库", path: "/knowledge", roles: ["ADMIN"] },
  { label: "对话", path: "/chat", roles: ["ADMIN", "USER"] },
  { label: "日志", path: "/logs", roles: ["ADMIN"] },
  { label: "成员", path: "/users", roles: ["ADMIN"] }
];

/** 应用路由把公开分享页、登录页和受保护工作台明确分开。 */
export function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivateInvitationPage />} />
        <Route path="/share/agents/:token" element={<SharedAgentPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<WorkspaceLayout />}>
            <Route index element={<DefaultWorkspaceRoute />} />
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route
                path="/providers"
                element={
                  <>
                    <ProvidersPage />
                    <HealthPage compact />
                  </>
                }
              />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/users" element={<UsersPage />} />
            </Route>
            <Route element={<RequireRole roles={["ADMIN", "USER"]} />}>
              <Route path="/chat" element={<ChatPage />} />
            </Route>
            <Route path="*" element={<DefaultWorkspaceRoute />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

/** 等待 Refresh Cookie 恢复期间不渲染受保护页面，避免短暂闪出后台数据。 */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <RouteLoading />;
  }

  if (status === "anonymous") {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  return <Outlet />;
}

/** 阻止用户通过手输 URL 进入不属于其角色的页面。 */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { currentUser } = useAuth();

  if (!currentUser || !roles.includes(currentUser.role)) {
    return <Navigate replace to="/chat" />;
  }

  return <Outlet />;
}

/** 根据角色选择工作台默认入口。 */
function DefaultWorkspaceRoute() {
  const { currentUser } = useAuth();

  return <Navigate replace to={currentUser?.role === "ADMIN" ? "/agents" : "/chat"} />;
}

/** 工作台壳层按当前角色渲染导航和账号退出入口。 */
function WorkspaceLayout() {
  const { currentUser, logoutCurrentDevice } = useAuth();
  const navigate = useNavigate();
  const availableNavItems = navConfig.filter((item) =>
    item.roles.includes(currentUser?.role ?? "USER")
  );

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">M</div>
          <div>
            <div className="brandName">Mia</div>
            <div className="brandMeta">AI Agent 平台</div>
          </div>
        </div>
        <nav className="navList" aria-label="主导航">
          {availableNavItems.map((item) => (
            <NavLink
              className={({ isActive }) => `navItem${isActive ? " active" : ""}`}
              end
              key={item.path}
              to={item.path}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Dropdown
          menu={{
            items: [
              {
                key: "logout",
                label: "退出登录",
                onClick: () => {
                  void logoutCurrentDevice().then(() => navigate("/login", { replace: true }));
                }
              }
            ]
          }}
          trigger={["click"]}
        >
          <Button className="accountMenu" type="text">
            <span>{currentUser?.displayName}</span>
            <small>{currentUser?.role === "ADMIN" ? "管理员" : "成员"}</small>
          </Button>
        </Dropdown>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function RouteLoading() {
  return (
    <section className="routeLoading">
      <Spin />
    </section>
  );
}
