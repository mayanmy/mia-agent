import { useEffect, useState } from "react";

import { getHealth, type HealthData } from "../shared/api/health";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: HealthData }
  | { status: "error"; message: string };

type HealthPageProps = {
  compact?: boolean;
};

export function HealthPage({ compact = false }: HealthPageProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let ignore = false;

    getHealth()
      .then((data) => {
        if (!ignore) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error"
          });
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <section className={compact ? "workspace compactHealth" : "workspace"}>
      {!compact && (
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Mia</h1>
          </div>
          <div className={`statusPill ${state.status}`}>
            {state.status === "ready" ? "Online" : state.status === "loading" ? "Checking" : "Offline"}
          </div>
        </header>
      )}

      <div className="panel">
        <div className="panelHeader">
          <h2>Backend Health</h2>
        </div>
        {state.status === "loading" && <p className="muted">Checking backend status...</p>}
        {state.status === "error" && <p className="errorText">{state.message}</p>}
        {state.status === "ready" && (
          <dl className="healthGrid">
            <div>
              <dt>Status</dt>
              <dd>{state.data.status}</dd>
            </div>
            <div>
              <dt>App</dt>
              <dd>{state.data.appName}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{state.data.version}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{state.data.environment}</dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
