import { lazy, Suspense, useState, type ReactNode } from "react";
import {
  ApiOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  ToolOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Button, Dropdown, Empty, Spin, Tooltip } from "antd";
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
import { CreateWorkspaceModal } from "../features/workspaces/components/CreateWorkspaceModal";
import { WorkspaceSwitcher } from "../features/workspaces/components/WorkspaceSwitcher";
import { useWorkspace } from "../features/workspaces/WorkspaceProvider";
import type { WorkspaceRole } from "../features/workspaces/types";
import {
  WorkspaceSectionTabs,
  type WorkspaceSectionTab
} from "../shared/components/WorkspaceSectionTabs";
import { useDisableNonLoginAutofill } from "../shared/hooks/useDisableNonLoginAutofill";

const AgentsPage = lazy(() =>
  import("../features/agents/AgentsPage").then((module) => ({ default: module.AgentsPage }))
);
const HomePage = lazy(() =>
  import("../features/home/HomePage").then((module) => ({ default: module.HomePage }))
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
const EvaluationDatasetsPage = lazy(() =>
  import("../features/evaluations/EvaluationDatasetsPage").then((module) => ({
    default: module.EvaluationDatasetsPage
  }))
);
const EvaluationDatasetPage = lazy(() =>
  import("../features/evaluations/EvaluationDatasetPage").then((module) => ({
    default: module.EvaluationDatasetPage
  }))
);
const EvaluationRunsPage = lazy(() =>
  import("../features/evaluations/EvaluationRunsPage").then((module) => ({
    default: module.EvaluationRunsPage
  }))
);
const EvaluationRunPage = lazy(() =>
  import("../features/evaluations/EvaluationRunPage").then((module) => ({
    default: module.EvaluationRunPage
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
const PlatformUsersPage = lazy(() =>
  import("../features/users/PlatformUsersPage").then((module) => ({
    default: module.PlatformUsersPage
  }))
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
  group: "overview" | "build" | "use" | "observe" | "admin";
  roles?: WorkspaceRole[];
  platformAdmin?: boolean;
  icon: ReactNode;
};

const navConfig: NavConfig[] = [
  {
    label: "工作台",
    path: "/home",
    group: "overview",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <HomeOutlined />
  },
  {
    label: "模型供应商",
    path: "/providers",
    group: "build",
    roles: ["OWNER", "MANAGER"],
    icon: <ApiOutlined />
  },
  {
    label: "Agent",
    path: "/agents",
    group: "build",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <RobotOutlined />
  },
  {
    label: "知识库",
    path: "/knowledge",
    group: "build",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <DatabaseOutlined />
  },
  {
    label: "Workflow",
    path: "/workflows",
    group: "build",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <ApartmentOutlined />
  },
  {
    label: "扩展能力",
    path: "/capabilities",
    group: "build",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <ToolOutlined />
  },
  {
    label: "对话",
    path: "/chat",
    group: "use",
    roles: ["OWNER", "MANAGER", "MEMBER"],
    icon: <MessageOutlined />
  },
  {
    label: "运行记录",
    path: "/operations",
    group: "observe",
    roles: ["OWNER", "MANAGER"],
    icon: <FileSearchOutlined />
  },
  {
    label: "设置",
    path: "/settings",
    group: "admin",
    roles: ["OWNER"],
    platformAdmin: true,
    icon: <SettingOutlined />
  }
];

const SIDEBAR_COLLAPSED_KEY = "mia.workspace.sidebarCollapsed";

/** 应用路由把公开分享页、登录页和受保护工作台明确分开。 */
export function App() {
  useDisableNonLoginAutofill();

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivateInvitationPage />} />
        <Route path="/share/agents/:token" element={<SharedAgentPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<WorkspaceLayout />}>
            <Route index element={<DefaultWorkspaceRoute />} />
            <Route element={<RequireRole roles={["OWNER", "MANAGER", "MEMBER"]} />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/chat" element={<ChatPage />} />
            </Route>

            <Route element={<RequireRole roles={["OWNER", "MANAGER"]} />}>
              <Route
                path="/providers"
                element={
                  <>
                    <ProvidersPage />
                    <PlatformAdminHealth />
                  </>
                }
              />
            </Route>

            <Route path="/workflows" element={<WorkflowSectionTabs />}>
              <Route index element={<WorkflowDefaultRoute />} />
              <Route element={<RequireRole roles={["OWNER", "MANAGER"]} />}>
                <Route path="design" element={<WorkflowsPage />} />
                <Route path="design/:workflowId" element={<WorkflowsPage />} />
              </Route>
              <Route element={<RequireRole roles={["OWNER", "MANAGER", "MEMBER"]} />}>
                <Route path="apps" element={<WorkflowAppsPage />} />
              </Route>
            </Route>

            <Route path="/capabilities" element={<CapabilitySectionTabs />}>
              <Route index element={<Navigate replace to="tools" />} />
              <Route element={<RequireRole roles={["OWNER", "MANAGER", "MEMBER"]} />}>
                <Route path="tools" element={<ToolsPage />} />
              </Route>
              <Route element={<RequireRole roles={["OWNER", "MANAGER"]} />}>
                <Route path="mcp" element={<McpServersPage />} />
                <Route path="skills" element={<SkillsPage />} />
              </Route>
            </Route>

            <Route element={<RequireRole roles={["OWNER", "MANAGER"]} />}>
              <Route path="/operations" element={<OperationSectionTabs />}>
                <Route index element={<Navigate replace to="traces" />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="traces" element={<AgentRunsPage />} />
                <Route path="evaluation-datasets" element={<EvaluationDatasetsPage />} />
                <Route path="evaluation-datasets/:datasetId" element={<EvaluationDatasetPage />} />
                <Route path="evaluations" element={<EvaluationRunsPage />} />
                <Route path="evaluations/runs/:runId" element={<EvaluationRunPage />} />
              </Route>
            </Route>

            <Route path="/settings" element={<SettingsSectionTabs />}>
              <Route index element={<SettingsDefaultRoute />} />
              <Route element={<RequireRole roles={["OWNER"]} />}>
                <Route path="members" element={<UsersPage />} />
              </Route>
              <Route element={<RequirePlatformAdmin />}>
                <Route path="accounts" element={<PlatformUsersPage />} />
              </Route>
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

/** 平台账号安全操作只看全局角色，不因当前空间身份变化。 */
function RequirePlatformAdmin() {
  const { currentUser } = useAuth();

  if (currentUser?.role !== "ADMIN") {
    return <Navigate replace to="/agents" />;
  }

  return <Outlet />;
}

/** 后端版本、环境等运行信息仅向平台管理员展示，空间角色不参与授权。 */
function PlatformAdminHealth() {
  const { currentUser } = useAuth();
  return currentUser?.role === "ADMIN" ? <HealthPage compact /> : null;
}

/** 所有已登录成员都可使用 Agent，成员管理仍通过独立管理员路由保护。 */
function DefaultWorkspaceRoute() {
  return <Navigate replace to="/home" />;
}

function WorkflowDefaultRoute() {
  const { currentWorkspace } = useWorkspace();
  return (
    <Navigate
      replace
      to={currentWorkspace?.role === "MEMBER" ? "/workflows/apps" : "/workflows/design"}
    />
  );
}

function WorkflowSectionTabs() {
  const { currentWorkspace } = useWorkspace();
  const tabs =
    currentWorkspace?.role === "MEMBER"
      ? [{ label: "已发布应用", path: "/workflows/apps" }]
      : [
          {
            label: "编排",
            path: "/workflows/design",
            match: (pathname: string) => pathname.startsWith("/workflows/design")
          },
          { label: "已发布应用", path: "/workflows/apps" }
        ];
  return <WorkspaceSectionTabs tabs={tabs} />;
}

function CapabilitySectionTabs() {
  const { currentWorkspace } = useWorkspace();
  const tabs = [{ label: "工具", path: "/capabilities/tools" }];
  if (currentWorkspace?.role !== "MEMBER") {
    tabs.push(
      { label: "MCP", path: "/capabilities/mcp" },
      { label: "Skill", path: "/capabilities/skills" }
    );
  }
  return <WorkspaceSectionTabs tabs={tabs} />;
}

function OperationSectionTabs() {
  return (
    <WorkspaceSectionTabs
      tabs={[
        { label: "运行链路", path: "/operations/traces" },
        { label: "请求日志", path: "/operations/logs" },
        {
          label: "评估运行",
          path: "/operations/evaluations",
          match: (pathname: string) => pathname.startsWith("/operations/evaluations")
        },
        {
          label: "评估数据集",
          path: "/operations/evaluation-datasets",
          match: (pathname: string) => pathname.startsWith("/operations/evaluation-datasets")
        }
      ]}
    />
  );
}

function SettingsDefaultRoute() {
  const { currentUser } = useAuth();
  const { currentWorkspace } = useWorkspace();
  if (currentWorkspace?.role === "OWNER") {
    return <Navigate replace to="/settings/members" />;
  }
  return <Navigate replace to={currentUser?.role === "ADMIN" ? "/settings/accounts" : "/agents"} />;
}

function SettingsSectionTabs() {
  const { currentUser } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const tabs: WorkspaceSectionTab[] = [];

  if (currentWorkspace?.role === "OWNER") {
    tabs.push({ label: "项目成员", path: "/settings/members" });
  }
  if (currentUser?.role === "ADMIN") {
    tabs.push({ label: "平台账号", path: "/settings/accounts" });
  }

  return <WorkspaceSectionTabs tabs={tabs} />;
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
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const availableNavItems = navConfig.filter(
    (item) =>
      Boolean(item.roles?.includes(currentWorkspace?.role ?? "MEMBER")) ||
      Boolean(item.platformAdmin && currentUser?.role === "ADMIN")
  );

  if (workspaceStatus !== "ready") {
    return <RouteLoading />;
  }

  if (!currentWorkspace) {
    if (currentUser?.role === "ADMIN" && location.pathname === "/settings/accounts") {
      return (
        <div className="platformStandalone">
          <header className="platformStandaloneHeader">
            <strong>Mia 平台管理</strong>
            <div>
              <Button icon={<PlusOutlined />} onClick={() => setCreateWorkspaceOpen(true)}>
                新建项目空间
              </Button>
              <Button
                onClick={() => {
                  void logoutCurrentDevice().then(() => navigate("/login", { replace: true }));
                }}
              >
                退出登录
              </Button>
            </div>
          </header>
          <main className="main">
            <Outlet />
          </main>
          <CreateWorkspaceModal
            open={createWorkspaceOpen}
            onCancel={() => setCreateWorkspaceOpen(false)}
            onCreated={async (workspace) => {
              await refreshWorkspaces(workspace.id);
              setCreateWorkspaceOpen(false);
              navigate("/home", { replace: true });
            }}
          />
        </div>
      );
    }
    return (
      <WorkspaceEmptyState
        canManageAccounts={currentUser?.role === "ADMIN"}
        onCreate={() => setCreateWorkspaceOpen(true)}
        onLogout={async () => {
          await logoutCurrentDevice();
          navigate("/login", { replace: true });
        }}
        onManageAccounts={() => navigate("/settings/accounts")}
      >
        <CreateWorkspaceModal
          open={createWorkspaceOpen}
          onCancel={() => setCreateWorkspaceOpen(false)}
          onCreated={async (workspace) => {
            await refreshWorkspaces(workspace.id);
            setCreateWorkspaceOpen(false);
            navigate("/home", { replace: true });
          }}
        />
      </WorkspaceEmptyState>
    );
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
        <WorkspaceSwitcher
          collapsed={sidebarCollapsed}
          currentWorkspace={currentWorkspace}
          workspaces={workspaces}
          onCreate={() => setCreateWorkspaceOpen(true)}
          onSwitch={(workspaceId) => {
            switchWorkspace(workspaceId);
            navigate("/home", { replace: true });
          }}
        />
        <nav className="navList" aria-label="主导航">
          {availableNavItems.map((item, index) => {
            const startsGroup = index === 0 || availableNavItems[index - 1]?.group !== item.group;
            const groupLabel = getNavGroupLabel(item.group);
            return (
              <div
                className={startsGroup && index > 0 ? "navGroupStart" : undefined}
                key={item.path}
              >
                {startsGroup && groupLabel && !sidebarCollapsed ? (
                  <span className="navGroupLabel">{groupLabel}</span>
                ) : null}
                <Tooltip placement="right" title={sidebarCollapsed ? item.label : undefined}>
                  <NavLink
                    aria-label={item.label}
                    className={({ isActive }) => `navItem${isActive ? " active" : ""}`}
                    end={
                      !["/workflows", "/capabilities", "/operations", "/settings"].includes(
                        item.path
                      )
                    }
                    to={item.path}
                  >
                    <span className="navItemIcon">{item.icon}</span>
                    <span className="navItemLabel">{item.label}</span>
                  </NavLink>
                </Tooltip>
              </div>
            );
          })}
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
      <CreateWorkspaceModal
        open={createWorkspaceOpen}
        onCancel={() => setCreateWorkspaceOpen(false)}
        onCreated={async (workspace) => {
          await refreshWorkspaces(workspace.id);
          setCreateWorkspaceOpen(false);
          navigate("/home", { replace: true });
        }}
      />
    </div>
  );
}

/** 无空间账号仍保留创建、平台管理和退出入口，避免落入无法操作的空白页。 */
function WorkspaceEmptyState({
  canManageAccounts,
  children,
  onCreate,
  onLogout,
  onManageAccounts
}: {
  canManageAccounts: boolean;
  children: ReactNode;
  onCreate: () => void;
  onLogout: () => Promise<void>;
  onManageAccounts: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  return (
    <section className="workspaceEmptyState">
      <Empty description="当前账号尚未加入项目空间">
        <div className="workspaceEmptyActions">
          <Button type="primary" onClick={onCreate}>
            创建项目空间
          </Button>
          {canManageAccounts ? <Button onClick={onManageAccounts}>账号管理</Button> : null}
          <Button
            loading={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void onLogout().finally(() => setLoggingOut(false));
            }}
          >
            退出登录
          </Button>
        </div>
      </Empty>
      {children}
    </section>
  );
}

function formatWorkspaceRole(role: WorkspaceRole): string {
  return role === "OWNER" ? "所有者" : role === "MANAGER" ? "项目管理员" : "成员";
}

/** 导航分组直接表达用户任务，避免把不同性质的功能堆成一张技术模块清单。 */
function getNavGroupLabel(group: NavConfig["group"]): string | null {
  if (group === "build") return "构建";
  if (group === "use") return "使用";
  if (group === "observe") return "观察";
  if (group === "admin") return "管理";
  return null;
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
