import { Checkbox, Empty, Tag } from "antd";

import type { ToolListItem } from "../../tools/api";

/** Agent 工具选择器的受控组件参数。 */
type AgentToolSelectorProps = {
  /** 可供选择的全部工具。 */
  tools: ToolListItem[];
  /** 当前已绑定的工具 ID。 */
  value?: string[];
  /** 绑定选择发生变化时回传完整 ID 集合。 */
  onChange?: (value: string[]) => void;
};

export function AgentToolSelector({ tools, value = [], onChange }: AgentToolSelectorProps) {
  // 当前发布列表不会返回历史版本；把已绑定版本补成可见选项，防止编辑 Agent 时被无声丢弃。
  const missingBindings: ToolListItem[] = value
    .filter((toolId) => !tools.some((tool) => tool.id === toolId))
    .map((toolId) => ({
      id: toolId,
      name: toolId.startsWith("workflow:") ? "已绑定 Workflow 历史版本" : "已绑定工具",
      description: "该绑定不在当前可选列表中；可继续保留，或取消后选择当前发布版本。",
      enabled: true,
      source: toolId.startsWith("workflow:") ? "workflow" : "standard"
    }));
  const visibleTools = [...tools, ...missingBindings];
  const enabledTools = visibleTools.filter((tool) => tool.enabled);
  const standardTools = visibleTools.filter((tool) => tool.source !== "workflow");
  const workflowTools = visibleTools.filter((tool) => tool.source === "workflow");

  if (visibleTools.length === 0) {
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
          可用 {enabledTools.length} / 全部 {visibleTools.length}
        </span>
      </div>
      <Checkbox.Group
        className="toolCheckboxGroup"
        value={value}
        onChange={(checkedValues) => onChange?.(checkedValues.map(String))}
      >
        <ToolGroup label="普通工具" tools={standardTools} />
        <ToolGroup label="Workflow" tools={workflowTools} />
      </Checkbox.Group>
    </div>
  );
}

/** 工具选择器内的来源分组参数。 */
type ToolGroupProps = {
  /** 分组标题。 */
  label: string;
  /** 分组内工具。 */
  tools: ToolListItem[];
};

/** Workflow 作为 Tool 展示，但仍提交到统一 toolIds，避免形成第二套绑定事务。 */
function ToolGroup({ label, tools }: ToolGroupProps) {
  if (tools.length === 0) return null;
  return (
    <div className="toolOptionGroup">
      <div className="toolOptionGroupTitle">{label}</div>
      {tools.map((tool) => (
        <Checkbox className="toolOptionCard" disabled={!tool.enabled} key={tool.id} value={tool.id}>
          <div className="toolOption">
            <div className="toolOptionHeader">
              <div>
                <div className="toolOptionName">{tool.name}</div>
                <div className="toolOptionId">
                  {tool.source === "workflow"
                    ? tool.workflowVersion
                      ? `Workflow v${tool.workflowVersion}`
                      : "已绑定历史版本"
                    : tool.id}
                </div>
              </div>
              <Tag color={tool.source === "workflow" ? "blue" : tool.enabled ? "green" : "default"}>
                {tool.source === "workflow" ? "Workflow" : tool.enabled ? "可用" : "停用"}
              </Tag>
            </div>
            <div className="toolOptionDescription">{tool.description}</div>
          </div>
        </Checkbox>
      ))}
    </div>
  );
}
