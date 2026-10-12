import { useEffect, useState } from "react";
import { App as AntdApp, Button, Drawer, Spin, Tag, Timeline, Typography } from "antd";

import { getAgentRunDetail, type AgentRunDetail } from "../api";
import "../agent-runs.less";

type AgentRunDetailDrawerProps = {
  runId: string | null;
  onClose: () => void;
  onOpenLogs?: (detail: AgentRunDetail) => void;
};

/** 可在聊天页和运行记录页复用的 Run Trace 抽屉，不要求调用方离开当前页面。 */
export function AgentRunDetailDrawer({ runId, onClose, onOpenLogs }: AgentRunDetailDrawerProps) {
  const { message } = AntdApp.useApp();
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setDetail(null);
      return;
    }

    let active = true;
    setLoading(true);
    setDetail(null);
    void getAgentRunDetail(runId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((error) => {
        if (active) message.error(error instanceof Error ? error.message : "加载 Run 详情失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [message, runId]);

  return (
    <Drawer
      destroyOnClose
      extra={
        detail?.requestId && onOpenLogs ? (
          <Button onClick={() => onOpenLogs(detail)}>查看请求日志</Button>
        ) : null
      }
      width={760}
      title="Run Trace 详情"
      open={Boolean(runId)}
      onClose={onClose}
    >
      {loading && !detail ? <Spin /> : detail ? <RunDetail detail={detail} /> : null}
    </Drawer>
  );
}

function RunDetail({ detail }: { detail: AgentRunDetail }) {
  return (
    <div className="runDetail">
      <div className="runSummary">
        {[
          ["Run ID", detail.id],
          ["Request ID", detail.requestId],
          ["状态", detail.status],
          ["来源", detail.source],
          ["Agent ID", detail.agentId],
          ["模型配置", detail.modelConfigId],
          ["Workflow ID", detail.workflowId],
          ["Workflow Version", detail.workflowVersionId],
          ["Workflow 模式", detail.workflowRunMode],
          ["总耗时", formatDuration(detail.startedAt, detail.finishedAt)],
          ["首 Token", formatDuration(detail.startedAt, detail.firstTokenAt)],
          ["Token", `${detail.inputTokens ?? "-"} / ${detail.outputTokens ?? "-"}`],
          ["错误", detail.errorType ? `${detail.errorType}: ${detail.errorMessage ?? ""}` : "-"]
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value || "-"}</strong>
          </div>
        ))}
      </div>
      <TraceBlock title="输入" value={detail.inputPreview} />
      <TraceBlock title="输出" value={detail.outputPreview} />
      <h2>Timeline</h2>
      <Timeline
        items={detail.steps.map((step) => ({
          color: statusColor(step.status),
          children: (
            <article className="runStep">
              <header>
                <strong>#{step.sequence} {step.type} · {step.name}</strong>
                <Tag color={statusColor(step.status)}>{step.status}</Tag>
                <span>{step.elapsedMs === null ? "-" : `${step.elapsedMs}ms`}</span>
              </header>
              {step.nodeId ? (
                <Typography.Text type="secondary" copyable className="runMono">
                  Node {step.nodeId} · Attempt {step.attempt}
                </Typography.Text>
              ) : null}
              {step.errorType ? <p className="runError">{step.errorType}: {step.errorMessage}</p> : null}
              <TraceBlock title="Input" value={step.input} />
              <TraceBlock title="Output" value={step.output} />
            </article>
          )
        }))}
      />
    </div>
  );
}

function TraceBlock({ title, value }: { title: string; value: unknown }) {
  if (value == null || value === "") return null;
  return (
    <section className="traceBlock">
      <h3>{title}</h3>
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function formatDuration(start: string | null, end: string | null) {
  if (!start || !end) return "-";
  return `${Math.max(0, new Date(end).getTime() - new Date(start).getTime())}ms`;
}

function statusColor(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "RUNNING") return "blue";
  if (status === "FAILED" || status === "TIMED_OUT") return "red";
  if (status === "WAITING_APPROVAL") return "gold";
  if (status === "CANCELED") return "orange";
  return "default";
}
