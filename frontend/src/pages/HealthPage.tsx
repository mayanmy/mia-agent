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
            message: error instanceof Error ? error.message : "未知错误"
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
            <p className="eyebrow">工作台</p>
            <h1>Mia</h1>
          </div>
          <div className={`statusPill ${state.status}`}>
            {state.status === "ready" ? "在线" : state.status === "loading" ? "检查中" : "离线"}
          </div>
        </header>
      )}

      <div className="panel">
        <div className="panelHeader">
          <h2>后端健康状态</h2>
        </div>
        {state.status === "loading" && <p className="muted">正在检查后端状态...</p>}
        {state.status === "error" && <p className="errorText">{state.message}</p>}
        {state.status === "ready" && (
          <dl className="healthGrid">
            <div>
              <dt>状态</dt>
              <dd>{state.data.status}</dd>
            </div>
            <div>
              <dt>应用</dt>
              <dd>{state.data.appName}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{state.data.version}</dd>
            </div>
            <div>
              <dt>环境</dt>
              <dd>{state.data.environment}</dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
