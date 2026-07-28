import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";

import type { WorkflowListItem } from "../types";

type Props = {
  workflows: WorkflowListItem[];
  selectedId: string | null;
  loading: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onArchive: (workflow: WorkflowListItem) => void;
};

export function WorkflowSidebar({
  workflows,
  selectedId,
  loading,
  onCreate,
  onSelect,
  onArchive
}: Props) {
  return (
    <aside className="workflowSidebar">
      <div className="workflowSidebarHeader">
        <div className="workflowPaneTitle">Workflows</div>
        <Tooltip title="新建 Workflow">
          <Button icon={<PlusOutlined />} type="text" onClick={onCreate} />
        </Tooltip>
      </div>
      <div className="workflowSidebarList" aria-busy={loading}>
        {!loading && workflows.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
        {workflows.map((workflow) => (
          <div
            className={`workflowSidebarItem${selectedId === workflow.id ? " active" : ""}`}
            key={workflow.id}
          >
            <button
              className="workflowSidebarItemMain"
              type="button"
              onClick={() => onSelect(workflow.id)}
            >
              <strong>{workflow.name}</strong>
              <small>{workflow.description || "无描述"}</small>
            </button>
            <span className="workflowSidebarItemMeta">
              <Tag color={workflow.status === "PUBLISHED" ? "green" : "default"}>
                {workflow.publishedVersion ? `v${workflow.publishedVersion}` : "草稿"}
              </Tag>
              <Tooltip title="归档 Workflow">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                  type="text"
                  onClick={(event) => {
                    event.stopPropagation();
                    onArchive(workflow);
                  }}
                />
              </Tooltip>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
