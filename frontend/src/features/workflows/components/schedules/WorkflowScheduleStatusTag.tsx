import { Tag } from "antd";

import type { WorkflowScheduleStatus } from "../../types";

export function WorkflowScheduleStatusTag({ status }: { status: WorkflowScheduleStatus }) {
  const meta = {
    ACTIVE: { color: "green", label: "已启用" },
    PAUSED: { color: "default", label: "已暂停" },
    ARCHIVED: { color: "red", label: "已归档" }
  }[status];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
