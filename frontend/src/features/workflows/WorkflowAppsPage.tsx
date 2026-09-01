import { useEffect, useState } from "react";
import { ApartmentOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Spin, Tag } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { WorkflowAppsGuide } from "../../shared/components/menu-guides";
import {
  listPublishedWorkflowApps,
  runPublishedWorkflow,
  type PublishedWorkflowApp,
  type WorkflowAppRunResult
} from "./api";
import { WorkflowRunModal } from "./components/WorkflowRunModal";
import "./workflows.less";

/** 普通成员使用的 Workflow 应用页，只暴露已发布版本和运行能力。 */
export function WorkflowAppsPage() {
  const { message } = AntdApp.useApp();
  const [apps, setApps] = useState<PublishedWorkflowApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApp, setSelectedApp] = useState<PublishedWorkflowApp | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkflowAppRunResult | null>(null);

  useEffect(() => {
    void listPublishedWorkflowApps()
      .then(setApps)
      .catch((error) =>
        message.error(error instanceof Error ? error.message : "加载 Workflow 应用失败")
      )
      .finally(() => setLoading(false));
  }, [message]);

  /** 独立入口始终提交卡片展示的当前发布版本，避免运行期间版本发生歧义。 */
  async function run(inputs: Record<string, unknown>) {
    if (!selectedApp) return;
    setRunning(true);
    setResult(null);
    try {
      setResult(await runPublishedWorkflow(selectedApp, inputs));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "运行 Workflow 失败");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="workspace workflowAppsWorkspace">
      <WorkspacePageHeader
        actions={<WorkflowAppsGuide />}
        description="直接运行团队已经发布的确定性流程。"
        title="Workflow 应用"
      />
      <Spin spinning={loading}>
        {apps.length ? (
          <div className="workflowGalleryGrid">
            {apps.map((app) => (
              <article className="workflowGalleryCard workflowAppCard" key={app.workflowId}>
                <div className="workflowGalleryCardHeader">
                  <span className="workflowGalleryCardIcon">
                    <ApartmentOutlined />
                  </span>
                  <div>
                    <strong>{app.name}</strong>
                    <small>Workflow 应用</small>
                  </div>
                  <Tag color="green">v{app.version}</Tag>
                </div>
                <p>{app.description || "暂无描述"}</p>
                <div className="workflowGalleryCardFooter">
                  <span>{app.inputs.length} 个输入</span>
                  <Button
                    icon={<PlayCircleOutlined />}
                    type="primary"
                    onClick={() => {
                      setResult(null);
                      setSelectedApp(app);
                    }}
                  >
                    运行
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : loading ? null : (
          <Empty description="暂无已发布的 Workflow" />
        )}
      </Spin>
      <WorkflowRunModal
        app={selectedApp}
        result={result}
        running={running}
        onCancel={() => {
          setSelectedApp(null);
          setResult(null);
        }}
        onRun={run}
      />
    </section>
  );
}
