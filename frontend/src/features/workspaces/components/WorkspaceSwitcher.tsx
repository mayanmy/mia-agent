import { CheckOutlined, PlusOutlined, ProjectOutlined } from "@ant-design/icons";
import { Button, Dropdown, Select, Tooltip } from "antd";
import type { MenuProps } from "antd";

import type { WorkspaceListItem } from "../types";

type WorkspaceSwitcherProps = {
  collapsed: boolean;
  currentWorkspace: WorkspaceListItem;
  workspaces: WorkspaceListItem[];
  onCreate: () => void;
  onSwitch: (workspaceId: string) => void;
};

/** 展开态显示选择框，收起态保留可识别、可操作的项目空间入口。 */
export function WorkspaceSwitcher({
  collapsed,
  currentWorkspace,
  workspaces,
  onCreate,
  onSwitch
}: WorkspaceSwitcherProps) {
  if (!collapsed) {
    return (
      <Select
        aria-label="当前项目空间"
        className="workspaceSelect"
        options={workspaces.map((workspace) => ({
          label: workspace.name,
          value: workspace.id
        }))}
        popupMatchSelectWidth={240}
        value={currentWorkspace.id}
        popupRender={(menu) => (
          <>
            {menu}
            <Button
              block
              icon={<PlusOutlined />}
              type="text"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onCreate}
            >
              新建项目空间
            </Button>
          </>
        )}
        onChange={onSwitch}
      />
    );
  }

  const items: MenuProps["items"] = [
    ...workspaces.map((workspace) => ({
      key: workspace.id,
      icon: workspace.id === currentWorkspace.id ? <CheckOutlined /> : undefined,
      label: workspace.name
    })),
    { type: "divider" },
    { key: "create", icon: <PlusOutlined />, label: "新建项目空间" }
  ];

  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "create") {
            onCreate();
            return;
          }
          onSwitch(key);
        }
      }}
      placement="bottomLeft"
      trigger={["click"]}
    >
      <Tooltip placement="right" title={`当前项目空间：${currentWorkspace.name}`}>
        <Button
          aria-label={`切换项目空间，当前为${currentWorkspace.name}`}
          className="workspaceSwitcherCollapsed"
          icon={<ProjectOutlined />}
          type="text"
        />
      </Tooltip>
    </Dropdown>
  );
}
