import { lazy, Suspense, useState, type ReactNode } from "react";
import {
  ApiOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Spin, Tooltip } from "antd";
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
const AgentRunsPage = lazy(() =>
  import("../features/agent-runs/AgentRunsPage").then((module) => ({
    default: module.AgentRunsPage
  }))
);
const WorkflowsPage = lazy(() =>
  import("../features/workflows/WorkflowsPage").then((module) => ({
    default: module.WorkflowsPage
  }))
);
const KnowledgePage = lazy(() =>
  import("../features/knowledge/KnowledgePage").then((module) => ({
    default: module.KnowledgePage
  }))
);
const UsersPage = lazy(() =>
  import("../features/users/UsersPage").then((module) => ({ default: module.UsersPage }))
);
const ToolsPage = lazy(() =>
  import("../features/tools/ToolsPage").then((module) => ({ default: module.ToolsPage }))
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
  icon: ReactNode;
};

const navConfig: NavConfig[] = [
  {
    label: "模型供应商",
    path: "/providers",
    roles: ["ADMIN", "USER"],
    icon: <ApiOutlined />
  },
  { label: "Agent", path: "/agents", roles: ["ADMIN", "USER"], icon: <RobotOutlined /> },
  {
    label: "知识库",
    path: "/knowledge",
    roles: ["ADMIN", "USER"],
    icon: <DatabaseOutlined />
  },
  { label: "工具", path: "/tools", roles: ["ADMIN"], icon: <ToolOutlined /> },
  { label: "Workflow", path: "/workflows", roles: ["ADMIN"], icon: <ApartmentOutlined /> },
  { label: "对话", path: "/chat", roles: ["ADMIN", "USER"], icon: <MessageOutlined /> },
  { label: "日志", path: "/logs", roles: ["ADMIN", "USER"], icon: <FileSearchOutlined /> },
  {
    label: "Run Trace",
    path: "/agent-runs",
    roles: ["ADMIN"],
    icon: <FundProjectionScreenOutlined />
  },
  { label: "成员", path: "/users", roles: ["ADMIN"], icon: <TeamOutlined /> }
];

const SIDEBAR_COLLAPSED_KEY = "mia.workspace.sidebarCollapsed";

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
            <Route element={<RequireRole roles={["ADMIN", "USER"]} />}>
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
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/logs" element={<LogsPage />} />
            </Route>
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflows/:workflowId" element={<WorkflowsPage />} />
              <Route path="/agent-runs" element={<AgentRunsPage />} />
              <Route path="/users" element={<UsersPage />} />
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

/** 所有已登录成员都可使用 Agent，成员管理仍通过独立管理员路由保护。 */
function DefaultWorkspaceRoute() {
  return <Navigate replace to="/agents" />;
}

/** 工作台壳层按当前角色渲染导航和账号退出入口。 */
function WorkspaceLayout() {
  const { currentUser, logoutCurrentDevice } = useAuth();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const availableNavItems = navConfig.filter((item) =>
    item.roles.includes(currentUser?.role ?? "USER")
  );

  /** 同步保存用户的桌面布局偏好，刷新和重新登录后继续沿用。 */
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // 隐私模式可能禁用 Storage，布局仍可在当前页面正常切换。
      }
      return next;
    });
  }

  return (
    <div className={`appShell${sidebarCollapsed ? " sidebarCollapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebarHeader">
          <div className="brand">
            <img src="/mia-logo.png" alt="Mia" className="brandLogo" />
            <div className="brandText">
              <div className="brandName">Mia</div>
              <div className="brandMeta">AI Agent 平台</div>
            </div>
          </div>
          <Tooltip title={sidebarCollapsed ? "展开菜单" : "收起菜单"} placement="right">
            <Button
              aria-label={sidebarCollapsed ? "展开菜单" : "收起菜单"}
              className="sidebarToggle"
              icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              type="text"
              onClick={toggleSidebar}
            />
          </Tooltip>
        </div>
        <nav className="navList" aria-label="主导航">
          {availableNavItems.map((item) => (
            <Tooltip
              key={item.path}
              placement="right"
              title={sidebarCollapsed ? item.label : undefined}
            >
              <NavLink
                aria-label={item.label}
                className={({ isActive }) => `navItem${isActive ? " active" : ""}`}
                end={item.path !== "/workflows"}
                to={item.path}
              >
                <span className="navItemIcon">{item.icon}</span>
                <span className="navItemLabel">{item.label}</span>
              </NavLink>
            </Tooltip>
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
          <Button
            aria-label="账户菜单"
            className="accountMenu"
            icon={<UserOutlined />}
            title={sidebarCollapsed ? currentUser?.displayName : undefined}
            type="text"
          >
            <span className="accountMenuText">
              <span>{currentUser?.displayName}</span>
              <small>{currentUser?.role === "ADMIN" ? "管理员" : "成员"}</small>
            </span>
          </Button>
        </Dropdown>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

/** Storage 读取失败时使用展开态，保证无持久化能力的浏览器也可正常进入工作台。 */
function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function RouteLoading() {
  return (
    <section className="routeLoading">
      <Spin />
    </section>
  );
}
