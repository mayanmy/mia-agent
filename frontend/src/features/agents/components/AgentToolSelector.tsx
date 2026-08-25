import { Checkbox, Empty, Tag } from "antd";

import type { ToolListItem } from "../../tools/api";

/** Agent 工具选择器的受控组件参数。 */
type AgentToolSelectorProps = {
  /** 当前页签只展示普通工具或 Workflow。 */
  bindingType: "tool" | "workflow";
  /** 可供选择的全部工具。 */
  tools: ToolListItem[];
  /** 当前已绑定的工具 ID。 */
  value?: string[];
  /** 绑定选择发生变化时回传完整 ID 集合。 */
  onChange?: (value: string[]) => void;
};

export function AgentToolSelector({
  bindingType,
  tools,
  value = [],
  onChange
}: AgentToolSelectorProps) {
  const workflowBinding = bindingType === "workflow";
  const belongsToCurrentTab = (toolId: string) =>
    toolId.startsWith("workflow:") === workflowBinding;
  const availableTools = tools.filter(
    (tool) => (tool.source === "workflow" || tool.id.startsWith("workflow:")) === workflowBinding
  );
  const selectedIds = value.filter(belongsToCurrentTab);
  // 当前发布列表不会返回历史版本；把已绑定版本补成可见选项，防止编辑 Agent 时被无声丢弃。
  const missingBindings: ToolListItem[] = selectedIds
    .filter((toolId) => !availableTools.some((tool) => tool.id === toolId))
    .map((toolId) => ({
      id: toolId,
      name: workflowBinding ? "已绑定 Workflow 历史版本" : "已绑定工具",
      description: "该绑定不在当前可选列表中；可继续保留，或取消后选择当前发布版本。",
      enabled: true,
      source: workflowBinding ? "workflow" : "standard"
    }));
  const visibleTools = [...availableTools, ...missingBindings];
  const enabledTools = visibleTools.filter((tool) => tool.enabled);

  if (visibleTools.length === 0) {
    return (
      <div className="toolSelectorEmpty">
        <Empty
          description={workflowBinding ? "暂无已发布的 Workflow" : "暂无可绑定工具"}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    );
  }

  return (
    <div className="toolSelector">
      <div className="toolSelectorSummary">
        <span>
          已绑定 {selectedIds.length} 个{workflowBinding ? " Workflow" : "工具"}
        </span>
        <span>
          可用 {enabledTools.length} / 全部 {visibleTools.length}
        </span>
      </div>
      <Checkbox.Group
        className="toolCheckboxGroup"
        value={selectedIds}
        onChange={(checkedValues) => {
          // 两个平级页签仍共享后端 toolIds；这里只替换当前类别，保留另一页签的选择。
          const otherBindings = value.filter((toolId) => !belongsToCurrentTab(toolId));
          onChange?.([...otherBindings, ...checkedValues.map(String)]);
        }}
      >
        <ToolOptions tools={visibleTools} />
      </Checkbox.Group>
    </div>
  );
}

/** 工具选择器内的来源分组参数。 */
type ToolOptionsProps = {
  /** 当前页签内的工具或 Workflow。 */
  tools: ToolListItem[];
};

/** 普通工具与 Workflow 复用同一卡片结构，来源语义由平级页签负责表达。 */
function ToolOptions({ tools }: ToolOptionsProps) {
  const mcpTools = tools.filter((tool) => tool.id.startsWith("mcp_"));
  const localTools = tools.filter((tool) => !tool.id.startsWith("mcp_"));

  return (
    <>
      {localTools.length > 0 && mcpTools.length > 0 ? (
        <div className="toolSelectorGroupTitle">本地与 HTTP 工具</div>
      ) : null}
      {localTools.map((tool) => (
        <ToolOption key={tool.id} tool={tool} />
      ))}
      {mcpTools.length > 0 ? <div className="toolSelectorGroupTitle">MCP 工具</div> : null}
      {mcpTools.map((tool) => (
        <ToolOption key={tool.id} tool={tool} />
      ))}
    </>
  );
}

function ToolOption({ tool }: { tool: ToolListItem }) {
  const isWorkflow = tool.source === "workflow";
  const isMcp = tool.id.startsWith("mcp_");
  return (
    <Checkbox className="toolOptionCard" disabled={!tool.enabled} value={tool.id}>
      <div className="toolOption">
        <div className="toolOptionHeader">
          <div>
            <div className="toolOptionName">{tool.name}</div>
            <div className="toolOptionId">
              {isWorkflow
                ? tool.workflowVersion
                  ? `Workflow v${tool.workflowVersion}`
                  : "已绑定历史版本"
                : tool.id}
            </div>
          </div>
          <Tag color={isWorkflow ? "blue" : isMcp ? "cyan" : tool.enabled ? "green" : "default"}>
            {isWorkflow ? "Workflow" : isMcp ? "MCP" : tool.enabled ? "可用" : "停用"}
          </Tag>
        </div>
        <div className="toolOptionDescription">{tool.description}</div>
      </div>
    </Checkbox>
  );
}
