import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import { AgentsPage } from "../features/agents/AgentsPage";
import { SharedAgentPage } from "../features/agents/SharedAgentPage";
import { ChatPage } from "../features/chat/ChatPage";
import { ProvidersPage } from "../features/model-providers/ProvidersPage";
import { HealthPage } from "../pages/HealthPage";

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
          <Route path="/knowledge" element={<PlaceholderPage title={navConfig.knowledge.label} />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/share/agents/:token" element={<SharedAgentPage />} />
          <Route path="/logs" element={<PlaceholderPage title={navConfig.logs.label} />} />
          <Route path="*" element={<Navigate replace to="/agents" />} />
        </Routes>
      </main>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="workspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">{title}</p>
          <h1>{title}</h1>
        </div>
      </header>
    </section>
  );
}
