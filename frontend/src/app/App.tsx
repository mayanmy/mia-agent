import { ProvidersPage } from "../features/model-providers/ProvidersPage";
import { HealthPage } from "../pages/HealthPage";

const navItems = ["Providers", "Agents", "Knowledge", "Chat", "Logs"];

export function App() {
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
            <a className="navItem" href="#" key={item}>
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        <ProvidersPage />
        <HealthPage compact />
      </main>
    </div>
  );
}
