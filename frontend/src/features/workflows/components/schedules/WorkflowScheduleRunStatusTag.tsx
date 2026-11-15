import { Tag } from "antd";

import type { WorkflowScheduleRunStatus } from "../../types";

const STATUS_META: Record<WorkflowScheduleRunStatus, { color: string; label: string }> = {
  QUEUED: { color: "default", label: "排队中" },
  RUNNING: { color: "processing", label: "运行中" },
  COMPLETED: { color: "success", label: "已完成" },
  FAILED: { color: "error", label: "失败" },
  CANCELED: { color: "warning", label: "已取消" },
  TIMED_OUT: { color: "error", label: "已超时" },
  SKIPPED: { color: "default", label: "已跳过" }
};

export function WorkflowScheduleRunStatusTag({ status }: { status: WorkflowScheduleRunStatus }) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
