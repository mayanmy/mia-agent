import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import "antd/dist/reset.css";

import { App } from "./app/App";
import { AuthProvider } from "./features/auth/AuthProvider";
import { WorkspaceProvider } from "./features/workspaces/WorkspaceProvider";
import "./styles.less";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          borderRadius: 8,
          colorPrimary: "#2563eb",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}
    >
      <BrowserRouter>
        <AntdApp>
          <AuthProvider>
            <WorkspaceProvider>
              <App />
            </WorkspaceProvider>
          </AuthProvider>
        </AntdApp>
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>
);
