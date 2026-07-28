import { useEffect, useState } from "react";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Empty, List, Spin, Tag, Timeline, Typography } from "antd";

import {
  getAgentRunDetail,
  listAgentRuns,
  type AgentRunDetail,
  type AgentRunListItem
} from "../../agent-runs/api";
import type { WorkflowTraceNodeStatus } from "../types";

type Props = {
  open: boolean;
  workflowId: string | null;
  onClose: () => void;
  onReplay: (statuses: Record<string, WorkflowTraceNodeStatus>) => void;
};

export function WorkflowTraceDrawer({ open, workflowId, onClose, onReplay }: Props) {
  const { message } = App.useApp();
  const [runs, setRuns] = useState<AgentRunListItem[]>([]);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workflowId) return;
    setLoading(true);
    setDetail(null);
    setRuns([]);
    void listAgentRuns({ workflowId, page: 1, pageSize: 30 })
      .then((result) => setRuns(result.list))
      .catch((error) => message.error(error instanceof Error ? error.message : "加载 Trace 失败"))
      .finally(() => setLoading(false));
  }, [open, workflowId]);

  async function selectRun(runId: string) {
    setLoading(true);
    try {
      const next = await getAgentRunDetail(runId);
      setDetail(next);
      onReplay(
        Object.fromEntries(
          next.steps
            .filter((step) => step.nodeId)
            .map((step) => [step.nodeId!, normalizeStatus(step.status)])
        )
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Trace 详情失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Drawer
      destroyOnClose
      open={open}
      title="Workflow Trace 回放"
      width={760}
      onClose={() => {
        onReplay({});
        onClose();
      }}
    >
      <Spin spinning={loading}>
        {!detail ? (
          runs.length > 0 ? (
            <List
              dataSource={runs}
              renderItem={(run) => (
                <List.Item className="workflowTraceRun" onClick={() => void selectRun(run.id)}>
                  <div>
                    <strong>
                      {new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </strong>
                    <Typography.Text type="secondary">{run.inputPreview}</Typography.Text>
                  </div>
                  <Tag color={statusColor(run.status)}>{run.status}</Tag>
                </List.Item>
              )}
            />
          ) : (
            <Empty description="暂无该 Workflow 的运行记录" />
          )
        ) : (
          <div className="workflowTraceDetail">
            <Button
              icon={<ArrowLeftOutlined />}
              type="text"
              onClick={() => {
                setDetail(null);
                onReplay({});
              }}
            >
              返回运行列表
            </Button>
            <div className="workflowTraceSummary">
              <span>{detail.status}</span>
              <code>{detail.id}</code>
              <span>{detail.workflowRunMode}</span>
            </div>
            <Timeline
              items={detail.steps.map((step) => ({
                color: statusColor(step.status),
                children: (
                  <article className="workflowTraceStep">
                    <header>
                      <strong>
                        #{step.sequence} {step.name}
                      </strong>
                      <Tag color={statusColor(step.status)}>{step.status}</Tag>
                      <span>{step.elapsedMs == null ? "-" : `${step.elapsedMs}ms`}</span>
                    </header>
                    <code>{step.nodeId || step.type}</code>
                    {step.errorMessage ? <p>{step.errorMessage}</p> : null}
                    {step.output != null ? <pre>{JSON.stringify(step.output, null, 2)}</pre> : null}
                  </article>
                )
              }))}
            />
          </div>
        )}
      </Spin>
    </Drawer>
  );
}

function normalizeStatus(status: string): WorkflowTraceNodeStatus {
  if (status === "FAILED") return "FAILED";
  if (status === "CANCELED") return "CANCELED";
  if (status === "RUNNING") return "RUNNING";
  if (status === "SKIPPED") return "SKIPPED";
  return "COMPLETED";
}

function statusColor(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "CANCELED") return "orange";
  if (status === "SKIPPED") return "default";
  return "blue";
}
