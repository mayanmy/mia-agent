import { useState } from "react";

import { AgentsPage } from "../features/agents/AgentsPage";
import { ProvidersPage } from "../features/model-providers/ProvidersPage";
import { HealthPage } from "../pages/HealthPage";

const navItems = ["providers", "agents", "knowledge", "chat", "logs"] as const;

type NavItem = (typeof navItems)[number];

const navLabels: Record<NavItem, string> = {
  providers: "模型供应商",
  agents: "Agent",
  knowledge: "知识库",
  chat: "对话",
  logs: "日志"
};

export function App() {
  const [activeNav, setActiveNav] = useState<NavItem>("agents");

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
            <button
              className={`navItem${activeNav === item ? " active" : ""}`}
              key={item}
              onClick={() => setActiveNav(item)}
              type="button"
            >
              {navLabels[item]}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {activeNav === "providers" && (
          <>
            <ProvidersPage />
            <HealthPage compact />
          </>
        )}
        {activeNav === "agents" && <AgentsPage />}
        {activeNav !== "providers" && activeNav !== "agents" && (
          <section className="workspace">
            <header className="pageHeader">
              <div>
                <p className="eyebrow">{navLabels[activeNav]}</p>
                <h1>{navLabels[activeNav]}</h1>
              </div>
            </header>
          </section>
        )}
      </main>
    </div>
  );
}
