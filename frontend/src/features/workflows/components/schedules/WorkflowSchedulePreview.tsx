import { Alert, Skeleton } from "antd";

import type { WorkflowSchedulePreview as Preview } from "../../types";

type Props = {
  loading: boolean;
  error: string | null;
  preview: Preview | null;
};

/** 后端是 Cron 与 DST 的唯一解释器；这里仅展示服务端返回的五个时间点。 */
export function WorkflowSchedulePreview({ loading, error, preview }: Props) {
  if (loading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (error) return <Alert showIcon type="error" message="无法预览执行时间" description={error} />;
  if (!preview) {
    return <Alert showIcon type="info" message="填写 Cron 和时区后将显示未来 5 次执行时间" />;
  }
  return (
    <div className="workflowSchedulePreview" aria-live="polite">
      <strong>未来 5 次执行时间</strong>
      <ol>
        {preview.nextOccurrences.map((occurrence) => (
          <li key={occurrence.scheduledFor}>
            <span>{occurrence.localTime}</span>
            <code>{occurrence.scheduledFor}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}
