import { Checkbox } from "antd";

import type { ToolListItem } from "../../tools/api";

export function AgentToolSelector({ tools }: { tools: ToolListItem[] }) {
  return (
    <Checkbox.Group
      className="toolCheckboxGroup"
      options={tools.map((tool) => ({
        label: (
          <div className="toolOption">
            <div className="toolOptionName">{tool.name}</div>
            <div className="toolOptionDescription">{tool.description}</div>
          </div>
        ),
        value: tool.id,
        disabled: !tool.enabled
      }))}
    />
  );
}
