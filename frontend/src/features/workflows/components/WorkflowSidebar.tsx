import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Empty, Tag, Tooltip } from "antd";

import type { WorkflowListItem } from "../types";

/** Workflow 列表侧栏参数。 */
type WorkflowSidebarProps = {
  /** 当前可编辑 Workflow 列表。 */
  workflows: WorkflowListItem[];
  /** 当前选中的 Workflow ID。 */
  selectedId: string | null;
  /** 列表是否正在加载。 */
  loading: boolean;
  /** 打开创建弹窗回调。 */
  onCreate: () => void;
  /** 选择 Workflow 回调。 */
  onSelect: (id: string) => void;
  /** 归档 Workflow 回调。 */
  onArchive: (workflow: WorkflowListItem) => void;
};

/** 展示 Workflow 列表、发布版本和归档入口。 */
export function WorkflowSidebar({
  workflows,
  selectedId,
  loading,
  onCreate,
  onSelect,
  onArchive
}: WorkflowSidebarProps) {
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
