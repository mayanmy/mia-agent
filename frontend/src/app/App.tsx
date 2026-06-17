import { lazy, Suspense } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";

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

const navItems = ["providers", "agents", "knowledge", "chat", "logs"] as const;

type NavItem = (typeof navItems)[number];

type NavConfig = {
  label: string;
  path: string;
};

const navConfig: Record<NavItem, NavConfig> = {
  providers: { label: "模型供应商", path: "/providers" },
  agents: { label: "Agent", path: "/agents" },
  knowledge: { label: "知识库", path: "/knowledge" },
  chat: { label: "对话", path: "/chat" },
  logs: { label: "日志", path: "/logs" }
};

export function App() {
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
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) => `navItem${isActive ? " active" : ""}`}
              end
              key={item}
              to={navConfig[item].path}
            >
              {navConfig[item].label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main">
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route index element={<Navigate replace to="/agents" />} />
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
            <Route path="/share/agents/:token" element={<SharedAgentPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="*" element={<Navigate replace to="/agents" />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function RouteLoading() {
  return (
    <section className="workspace">
      <header className="compactPageHeader">
        <div>
          <h1>正在加载页面</h1>
        </div>
      </header>
    </section>
  );
}
