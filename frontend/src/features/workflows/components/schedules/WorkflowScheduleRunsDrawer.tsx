import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Select,
  Space,
  Spin,
  Typography
} from "antd";

import type {
  WorkflowScheduleListItem,
  WorkflowScheduleRunDetail,
  WorkflowScheduleRunListItem,
  WorkflowScheduleRunStatus
} from "../../types";
import { WorkflowScheduleRunStatusTag } from "./WorkflowScheduleRunStatusTag";
import { WorkflowScheduleRunTable } from "./WorkflowScheduleRunTable";

type Props = {
  schedule: WorkflowScheduleListItem | null;
  runs: WorkflowScheduleRunListItem[];
  total: number;
  page: number;
  pageSize: number;
  status?: WorkflowScheduleRunStatus;
  loading: boolean;
  detail: WorkflowScheduleRunDetail | null;
  detailLoading: boolean;
  canceling: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onStatusChange: (status?: WorkflowScheduleRunStatus) => void;
  onSelect: (run: WorkflowScheduleRunListItem) => void;
  onCloseDetail: () => void;
  onCancelRun: () => void;
  onOpenAgentRun: (runId: string) => void;
};

const statusOptions: Array<{ value: WorkflowScheduleRunStatus; label: string }> = [
  ["QUEUED", "排队中"],
  ["RUNNING", "运行中"],
  ["COMPLETED", "已完成"],
  ["FAILED", "失败"],
  ["TIMED_OUT", "已超时"],
  ["CANCELED", "已取消"],
  ["SKIPPED", "已跳过"]
].map(([value, label]) => ({ value: value as WorkflowScheduleRunStatus, label }));

export function WorkflowScheduleRunsDrawer(props: Props) {
  const cancelable = props.detail?.status === "QUEUED" || props.detail?.status === "RUNNING";
  return (
    <Drawer
      destroyOnClose
      open={Boolean(props.schedule)}
      width={980}
      title={props.detail ? "运行详情" : `${props.schedule?.name ?? "定时任务"} · 运行历史`}
      onClose={props.onClose}
      extra={
        props.detail ? (
          <Button icon={<ArrowLeftOutlined />} onClick={props.onCloseDetail}>
            返回列表
          </Button>
        ) : (
          <Button aria-label="刷新运行历史" icon={<ReloadOutlined />} onClick={props.onRefresh} />
        )
      }
    >
      {props.detailLoading ? (
        <Spin />
      ) : props.detail ? (
        <RunDetail
          detail={props.detail}
          cancelable={cancelable}
          canceling={props.canceling}
          onCancel={props.onCancelRun}
          onOpenAgentRun={props.onOpenAgentRun}
        />
      ) : (
        <>
          <Space className="workflowScheduleRunFilters" wrap>
            <Typography.Text type="secondary">按状态筛选</Typography.Text>
            <Select
              allowClear
              aria-label="运行状态"
              options={statusOptions}
              placeholder="全部状态"
              value={props.status}
              style={{ width: 150 }}
              onChange={props.onStatusChange}
            />
          </Space>
          {!props.loading && props.runs.length === 0 ? (
            <Empty description="暂无符合条件的运行记录" />
          ) : (
            <WorkflowScheduleRunTable
              loading={props.loading}
              page={props.page}
              pageSize={props.pageSize}
              runs={props.runs}
              total={props.total}
              onPageChange={props.onPageChange}
              onSelect={props.onSelect}
            />
          )}
        </>
      )}
    </Drawer>
  );
}

function RunDetail({
  detail,
  cancelable,
  canceling,
  onCancel,
  onOpenAgentRun
}: {
  detail: WorkflowScheduleRunDetail;
  cancelable: boolean;
  canceling: boolean;
  onCancel: () => void;
  onOpenAgentRun: (runId: string) => void;
}) {
  const items = [
    ["状态", <WorkflowScheduleRunStatusTag status={detail.status} />],
    ["Run ID", detail.id],
    ["Request ID", detail.requestId],
    ["Workflow 版本", `v${detail.workflowVersion}`],
    ["触发方式", detail.trigger === "MANUAL_BACKFILL" ? "手动补跑" : "定时触发"],
    ["计划时间", formatTime(detail.scheduledFor)],
    ["开始时间", formatTime(detail.startedAt)],
    ["结束时间", formatTime(detail.finishedAt)],
    ["排队耗时", formatDuration(detail.queueWaitMs)],
    ["执行耗时", formatDuration(detail.durationMs)],
    ["尝试次数", String(detail.attempt)],
    ["Worker", detail.workerId ?? "-"],
    ["最近心跳", formatTime(detail.heartbeatAt)]
  ].map(([label, children]) => ({ label, children }));
  return (
    <div className="workflowScheduleRunDetail">
      <Space className="workflowScheduleRunActions" wrap>
        {detail.agentRunId ? (
          <Button onClick={() => onOpenAgentRun(detail.agentRunId!)}>查看 Run Trace</Button>
        ) : null}
        {cancelable ? (
          <Popconfirm
            title="确认取消这次运行？"
            okText="取消运行"
            cancelText="返回"
            onConfirm={onCancel}
          >
            <Button danger loading={canceling}>
              取消运行
            </Button>
          </Popconfirm>
        ) : null}
      </Space>
      <Descriptions bordered column={{ xs: 1, sm: 2 }} items={items} size="small" />
      {detail.errorMessage ? (
        <section className="workflowScheduleRunError">
          <Typography.Text strong>失败原因</Typography.Text>
          <Typography.Paragraph type="danger">
            {detail.errorType}: {detail.errorMessage}
          </Typography.Paragraph>
        </section>
      ) : null}
    </div>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
}

function formatDuration(value: number | null) {
  if (value === null) return "-";
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`;
}
