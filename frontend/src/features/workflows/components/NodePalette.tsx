import type { ReactNode } from "react";
import {
  BranchesOutlined,
  DatabaseOutlined,
  FlagOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  ToolOutlined,
  FormOutlined
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";

import type { WorkflowNodeType } from "../types";
import { NODE_LABELS } from "../utils";

/** 节点库中的单个可添加项。 */
type NodePaletteItem = {
  /** 要创建的节点类型。 */
  type: WorkflowNodeType;
  /** 节点类型图标。 */
  icon: ReactNode;
};

/** 节点库参数。 */
type NodePaletteProps = {
  /** 点击节点类型后的添加回调。 */
  onAdd: (type: WorkflowNodeType) => void;
};

const items: NodePaletteItem[] = [
  { type: "start", icon: <PlayCircleOutlined /> },
  { type: "llm", icon: <RobotOutlined /> },
  { type: "retrieval", icon: <DatabaseOutlined /> },
  { type: "tool", icon: <ToolOutlined /> },
  { type: "condition", icon: <BranchesOutlined /> },
  { type: "template", icon: <FormOutlined /> },
  { type: "end", icon: <FlagOutlined /> }
];

/** 展示当前 Workflow 支持的节点类型。 */
export function NodePalette({ onAdd }: NodePaletteProps) {
  return (
    <aside className="workflowPalette" aria-label="节点库">
      <div className="workflowPaneTitle">节点</div>
      {items.map((item) => (
        <Tooltip key={item.type} placement="right" title={`添加${NODE_LABELS[item.type]}节点`}>
          <Button icon={item.icon} onClick={() => onAdd(item.type)}>
            {NODE_LABELS[item.type]}
          </Button>
        </Tooltip>
      ))}
    </aside>
  );
}
