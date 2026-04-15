import { useState } from "react";

import { AgentsPage } from "../features/agents/AgentsPage";
import { ProvidersPage } from "../features/model-providers/ProvidersPage";
import { HealthPage } from "../pages/HealthPage";

const navItems = ["Providers", "Agents", "Knowledge", "Chat", "Logs"] as const;

type NavItem = (typeof navItems)[number];

export function App() {
  const [activeNav, setActiveNav] = useState<NavItem>("Agents");

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">M</div>
          <div>
            <div className="brandName">Mia</div>
            <div className="brandMeta">AI Agent Platform</div>
          </div>
        </div>
        <nav className="navList" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              className={`navItem${activeNav === item ? " active" : ""}`}
              key={item}
              onClick={() => setActiveNav(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {activeNav === "Providers" && (
          <>
            <ProvidersPage />
            <HealthPage compact />
          </>
        )}
        {activeNav === "Agents" && <AgentsPage />}
        {activeNav !== "Providers" && activeNav !== "Agents" && (
          <section className="workspace">
            <header className="pageHeader">
              <div>
                <p className="eyebrow">{activeNav}</p>
                <h1>{activeNav}</h1>
              </div>
            </header>
          </section>
        )}
      </main>
    </div>
  );
}
