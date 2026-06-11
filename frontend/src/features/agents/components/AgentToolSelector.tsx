import { Checkbox, Empty, Tag } from "antd";

import type { ToolListItem } from "../../tools/api";

type AgentToolSelectorProps = {
  tools: ToolListItem[];
  value?: string[];
  onChange?: (value: string[]) => void;
};

export function AgentToolSelector({ tools, value = [], onChange }: AgentToolSelectorProps) {
  const enabledTools = tools.filter((tool) => tool.enabled);

  if (tools.length === 0) {
    return (
      <div className="toolSelectorEmpty">
        <Empty description="暂无可绑定工具" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  return (
    <div className="toolSelector">
      <div className="toolSelectorSummary">
        <span>已绑定 {value.length} 个工具</span>
        <span>
          可用 {enabledTools.length} / 全部 {tools.length}
        </span>
      </div>
      <Checkbox.Group
        className="toolCheckboxGroup"
        value={value}
        onChange={(checkedValues) => onChange?.(checkedValues.map(String))}
      >
        {tools.map((tool) => (
          <Checkbox className="toolOptionCard" disabled={!tool.enabled} key={tool.id} value={tool.id}>
            <div className="toolOption">
              <div className="toolOptionHeader">
                <div>
                  <div className="toolOptionName">{tool.name}</div>
                  <div className="toolOptionId">{tool.id}</div>
                </div>
                <Tag color={tool.enabled ? "green" : "default"}>
                  {tool.enabled ? "可用" : "停用"}
                </Tag>
              </div>
              <div className="toolOptionDescription">{tool.description}</div>
            </div>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </div>
  );
}
