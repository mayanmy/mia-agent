import { FunctionOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, type MenuProps } from "antd";

import type { WorkflowVariableDescriptor } from "../../editor/variables";

/** 支持可视化插入 Workflow 表达式的文本框参数。 */
type VariableTextAreaProps = {
  /** 当前模板文本。 */
  value: string;
  /** 当前节点可引用的上游变量。 */
  variables: WorkflowVariableDescriptor[];
  /** 最小和最大自适应行数。 */
  autoSize: { minRows: number; maxRows: number };
  /** 文本变化回调。 */
  onChange: (value: string) => void;
};

/** 变量菜单将普通表达式写回 Graph，不持久化富文本展示结构。 */
export function VariableTextArea({ value, variables, autoSize, onChange }: VariableTextAreaProps) {
  const items: MenuProps["items"] = variables.length
    ? variables.map((variable) => ({
        key: variable.expression,
        label: `${variable.label} · ${variable.type}`
      }))
    : [{ key: "empty", label: "当前没有可用的上游变量", disabled: true }];
  return (
    <div className="workflowVariableInput">
      <Input.TextArea
        autoSize={autoSize}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <Dropdown
        menu={{
          items,
          onClick: ({ key }) =>
            onChange(`${value}${value && !value.endsWith(" ") ? " " : ""}${key}`)
        }}
        overlayClassName="workflowVariableDropdown"
        placement="bottomRight"
        trigger={["click"]}
      >
        <Button icon={<FunctionOutlined />} size="small" title="插入上游变量">
          变量
        </Button>
      </Dropdown>
    </div>
  );
}
