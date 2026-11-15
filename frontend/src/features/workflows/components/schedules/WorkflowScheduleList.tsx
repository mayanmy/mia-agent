import {
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, List, Popconfirm, Space, Tooltip } from "antd";

import type { WorkflowScheduleListItem } from "../../types";
import { WorkflowScheduleStatusTag } from "./WorkflowScheduleStatusTag";

type Props = {
  open: boolean;
  loading: boolean;
  schedules: WorkflowScheduleListItem[];
  onClose: () => void;
  onCreate: () => void;
  onEdit: (schedule: WorkflowScheduleListItem) => void;
  onPause: (schedule: WorkflowScheduleListItem) => void;
  onResume: (schedule: WorkflowScheduleListItem) => void;
  onArchive: (schedule: WorkflowScheduleListItem) => void;
};

export function WorkflowScheduleList({
  open,
  loading,
  schedules,
  onClose,
  onCreate,
  onEdit,
  onPause,
  onResume,
  onArchive
}: Props) {
  return (
    <Drawer
      open={open}
      title="Workflow 定时任务"
      width={680}
      extra={
        <Button icon={<PlusOutlined />} type="primary" onClick={onCreate}>
          新建任务
        </Button>
      }
      onClose={onClose}
    >
      <Alert
        showIcon
        type="info"
        message="调度执行尚未启用"
        description="当前阶段仅提供配置、预览和状态管理，不会自动运行 Workflow。"
      />
      <List
        className="workflowScheduleList"
        dataSource={schedules}
        loading={loading}
        locale={{
          emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有定时任务" />
        }}
        renderItem={(schedule) => (
          <List.Item
            actions={[
              <Tooltip title="编辑配置" key="edit">
                <Button
                  aria-label={`编辑 ${schedule.name}`}
                  icon={<EditOutlined />}
                  type="text"
                  onClick={() => onEdit(schedule)}
                />
              </Tooltip>,
              schedule.status === "ACTIVE" ? (
                <Tooltip title="暂停" key="toggle">
                  <Button
                    aria-label={`暂停 ${schedule.name}`}
                    icon={<PauseCircleOutlined />}
                    type="text"
                    onClick={() => onPause(schedule)}
                  />
                </Tooltip>
              ) : (
                <Tooltip title="启用" key="toggle">
                  <Button
                    aria-label={`启用 ${schedule.name}`}
                    icon={<PlayCircleOutlined />}
                    type="text"
                    onClick={() => onResume(schedule)}
                  />
                </Tooltip>
              ),
              <Popconfirm
                key="archive"
                title="归档这个定时任务？"
                okText="归档"
                cancelText="取消"
                onConfirm={() => onArchive(schedule)}
              >
                <Tooltip title="归档">
                  <Button
                    danger
                    aria-label={`归档 ${schedule.name}`}
                    icon={<DeleteOutlined />}
                    type="text"
                  />
                </Tooltip>
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <span>{schedule.name}</span>
                  <WorkflowScheduleStatusTag status={schedule.status} />
                  <span className="workflowScheduleVersion">v{schedule.workflowVersion}</span>
                </Space>
              }
              description={
                <div className="workflowScheduleMeta">
                  <code>{schedule.cronExpression}</code>
                  <span>{schedule.timezone}</span>
                  <span>
                    {schedule.nextRunAt
                      ? `下次：${new Date(schedule.nextRunAt).toLocaleString("zh-CN", { hour12: false })}`
                      : "暂无下次执行时间"}
                  </span>
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Drawer>
  );
}
