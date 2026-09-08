import { lazy, Suspense, useState, type ReactNode } from "react";
import {
  ApiOutlined,
  ApartmentOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PlaySquareOutlined,
  RobotOutlined,
  ReadOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Select, Spin, Tooltip } from "antd";
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
import { createWorkspace } from "../features/workspaces/api";
import { useWorkspace } from "../features/workspaces/WorkspaceProvider";
import type { WorkspaceRole } from "../features/workspaces/types";

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
const WorkflowAppsPage = lazy(() =>
  import("../features/workflows/WorkflowAppsPage").then((module) => ({
    default: module.WorkflowAppsPage
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
const McpServersPage = lazy(() =>
  import("../features/mcp/McpServersPage").then((module) => ({
    default: module.McpServersPage
  }))
);
const SkillsPage = lazy(() =>
  import("../features/skills/SkillsPage").then((module) => ({ default: module.SkillsPage }))
);
const ActivateInvitationPage = lazy(() =>
  import("../features/auth/ActivateInvitationPage").then((module) => ({
    default: module.ActivateInvitationPage
  }))
);

type NavConfig = {
  label: string;
  path: string;
  roles: WorkspaceRole[];
  icon: ReactNode;
};

const navConfig: NavConfig[] = [
  {
    label: "模型供应商",
    path: "/providers",
    roles: ["OWNER", "ADMIN"],
    icon: <ApiOutlined />
  },
  {
    label: "Agent",
    path: "/agents",
    roles: ["OWNER", "ADMIN", "MEMBER"],
    icon: <RobotOutlined />
  },
  {
    label: "知识库",
    path: "/knowledge",
    roles: ["OWNER", "ADMIN", "MEMBER"],
    icon: <DatabaseOutlined />
  },
  { label: "工具", path: "/tools", roles: ["OWNER", "ADMIN"], icon: <ToolOutlined /> },
  { label: "MCP", path: "/mcp", roles: ["OWNER", "ADMIN"], icon: <CloudServerOutlined /> },
  { label: "Skill", path: "/skills", roles: ["OWNER", "ADMIN"], icon: <ReadOutlined /> },
  {
    label: "Workflow",
    path: "/workflows",
    roles: ["OWNER", "ADMIN"],
    icon: <ApartmentOutlined />
  },
  {
    label: "Workflow 应用",
    path: "/workflow-apps",
    roles: ["OWNER", "ADMIN", "MEMBER"],
    icon: <PlaySquareOutlined />
  },
  {
    label: "对话",
    path: "/chat",
    roles: ["OWNER", "ADMIN", "MEMBER"],
    icon: <MessageOutlined />
  },
  { label: "日志", path: "/logs", roles: ["OWNER", "ADMIN"], icon: <FileSearchOutlined /> },
  {
    label: "Run Trace",
    path: "/agent-runs",
    roles: ["OWNER", "ADMIN"],
    icon: <FundProjectionScreenOutlined />
  },
  { label: "成员", path: "/users", roles: ["OWNER", "ADMIN"], icon: <TeamOutlined /> }
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
            <Route element={<RequireRole roles={["OWNER", "ADMIN", "MEMBER"]} />}>
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
              <Route path="/workflow-apps" element={<WorkflowAppsPage />} />
              <Route path="/chat" element={<ChatPage />} />
            </Route>
            <Route element={<RequireRole roles={["OWNER", "ADMIN"]} />}>
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/mcp" element={<McpServersPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/workflows" element={<WorkflowsPage />} />
              <Route path="/workflows/:workflowId" element={<WorkflowsPage />} />
              <Route path="/agent-runs" element={<AgentRunsPage />} />
              <Route path="/logs" element={<LogsPage />} />
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
function RequireRole({ roles }: { roles: WorkspaceRole[] }) {
  const { currentWorkspace } = useWorkspace();

  if (!currentWorkspace || !roles.includes(currentWorkspace.role)) {
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
  const {
    status: workspaceStatus,
    workspaces,
    currentWorkspace,
    switchWorkspace,
    refreshWorkspaces
  } = useWorkspace();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const availableNavItems = navConfig.filter((item) =>
    item.roles.includes(currentWorkspace?.role ?? "MEMBER")
  );

  if (workspaceStatus !== "ready") {
    return <RouteLoading />;
  }

  if (!currentWorkspace) {
    return <WorkspaceEmptyState onCreated={refreshWorkspaces} />;
  }

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
        <Select
          aria-label="当前项目空间"
          className="workspaceSelect"
          options={workspaces.map((workspace) => ({
            label: workspace.name,
            value: workspace.id
          }))}
          popupMatchSelectWidth={240}
          value={currentWorkspace.id}
          onChange={(workspaceId) => {
            switchWorkspace(workspaceId);
            navigate("/agents", { replace: true });
          }}
        />
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
              <small>{formatWorkspaceRole(currentWorkspace.role)}</small>
            </span>
          </Button>
        </Dropdown>
      </aside>
      <main className="main">
        {/* 切换空间时强制重建路由页，避免页面状态继续保留上一空间的数据。 */}
        <Outlet key={currentWorkspace.id} />
      </main>
    </div>
  );
}

/** 无任何成员关系的账号可以创建首个项目空间并自动成为 OWNER。 */
function WorkspaceEmptyState({ onCreated }: { onCreated: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  return (
    <section className="workspaceEmptyState">
      <Empty description="当前账号尚未加入项目空间">
        <Button
          loading={creating}
          type="primary"
          onClick={() => {
            setCreating(true);
            void createWorkspace({ name: "我的项目空间" })
              .then(onCreated)
              .finally(() => setCreating(false));
          }}
        >
          创建项目空间
        </Button>
      </Empty>
    </section>
  );
}

function formatWorkspaceRole(role: WorkspaceRole): string {
  return role === "OWNER" ? "所有者" : role === "ADMIN" ? "管理员" : "成员";
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
