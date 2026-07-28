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

const items: Array<{ type: WorkflowNodeType; icon: ReactNode }> = [
  { type: "start", icon: <PlayCircleOutlined /> },
  { type: "llm", icon: <RobotOutlined /> },
  { type: "retrieval", icon: <DatabaseOutlined /> },
  { type: "tool", icon: <ToolOutlined /> },
  { type: "condition", icon: <BranchesOutlined /> },
  { type: "template", icon: <FormOutlined /> },
  { type: "end", icon: <FlagOutlined /> }
];

export function NodePalette({ onAdd }: { onAdd: (type: WorkflowNodeType) => void }) {
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
