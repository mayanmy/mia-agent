import { Button, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { WorkflowScheduleRunListItem } from "../../types";
import { WorkflowScheduleRunStatusTag } from "./WorkflowScheduleRunStatusTag";

type Props = {
  runs: WorkflowScheduleRunListItem[];
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onSelect: (run: WorkflowScheduleRunListItem) => void;
};

const columns: ColumnsType<WorkflowScheduleRunListItem> = [
  {
    title: "计划时间",
    dataIndex: "scheduledFor",
    width: 180,
    render: (value: string) => formatTime(value)
  },
  {
    title: "状态",
    dataIndex: "status",
    width: 100,
    render: (status) => <WorkflowScheduleRunStatusTag status={status} />
  },
  {
    title: "触发方式",
    dataIndex: "trigger",
    width: 100,
    render: (value) => (value === "MANUAL_BACKFILL" ? "手动补跑" : "定时触发")
  },
  { title: "版本", dataIndex: "workflowVersion", width: 72, render: (value) => `v${value}` },
  {
    title: "排队 / 执行",
    width: 150,
    render: (_, run) => `${formatDuration(run.queueWaitMs)} / ${formatDuration(run.durationMs)}`
  },
  {
    title: "结果",
    ellipsis: true,
    render: (_, run) =>
      run.errorMessage ? (
        <Typography.Text type="danger" title={run.errorMessage}>
          {run.errorMessage}
        </Typography.Text>
      ) : (
        "-"
      )
  },
  {
    title: "操作",
    key: "actions",
    fixed: "right",
    width: 76
  }
];

/** Schedule Run 表格保持无 API 副作用，便于列表抽屉独立复用。 */
export function WorkflowScheduleRunTable({
  runs,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  onSelect
}: Props) {
  const tableColumns = columns.map((column) =>
    column.key === "actions"
      ? {
          ...column,
          render: (_: unknown, run: WorkflowScheduleRunListItem) => (
            <Button type="link" onClick={() => onSelect(run)}>
              详情
            </Button>
          )
        }
      : column
  );
  return (
    <Table
      rowKey="id"
      columns={tableColumns}
      dataSource={runs}
      loading={loading}
      scroll={{ x: 920 }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: false,
        onChange: onPageChange
      }}
    />
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(value: number | null) {
  if (value === null) return "-";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}
