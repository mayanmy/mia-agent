import { Alert, Drawer, Empty, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { TableProps } from "antd";

import type { McpRiskLevel, McpServerListItem, McpServerTool } from "../api";

type McpToolsDrawerProps = {
  server: McpServerListItem | null;
  tools: McpServerTool[];
  loading: boolean;
  updatingToolId: string | null;
  onClose: () => void;
  onUpdate: (tool: McpServerTool, changes: Partial<McpServerTool>) => void;
};

export function McpToolsDrawer({
  server,
  tools,
  loading,
  updatingToolId,
  onClose,
  onUpdate
}: McpToolsDrawerProps) {
  const columns: TableProps<McpServerTool>["columns"] = [
    {
      title: "工具",
      render: (_, tool) => (
        <div className="mcpToolIdentity">
          <strong>{tool.title || tool.remoteName}</strong>
          <code>{tool.remoteName}</code>
          <Typography.Text type="secondary">{tool.description || "暂无描述"}</Typography.Text>
        </div>
      )
    },
    {
      title: "可用性",
      dataIndex: "available",
      width: 92,
      render: (available: boolean) => (
        <Tag color={available ? "green" : "red"}>{available ? "已发现" : "已失联"}</Tag>
      )
    },
    {
      title: "风险",
      dataIndex: "riskLevel",
      width: 126,
      render: (riskLevel: McpRiskLevel, tool) => (
        <Select
          aria-label={`${tool.remoteName} 风险等级`}
          disabled={updatingToolId === tool.id}
          options={[
            { label: "低风险", value: "low" },
            { label: "中风险", value: "medium" },
            { label: "高风险", value: "high" }
          ]}
          size="small"
          value={riskLevel}
          onChange={(value) => onUpdate(tool, { riskLevel: value })}
        />
      )
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 78,
      render: (enabled: boolean, tool) => (
        <Switch
          aria-label={`${tool.remoteName} 启用状态`}
          checked={enabled}
          disabled={!tool.available}
          loading={updatingToolId === tool.id}
          size="small"
          onChange={(checked) => onUpdate(tool, { enabled: checked })}
        />
      )
    }
  ];

  return (
    <Drawer
      destroyOnHidden
      open={Boolean(server)}
      title={server ? `${server.name} · 工具目录` : "工具目录"}
      width={760}
      onClose={onClose}
    >
      <Space className="mcpToolDrawerSummary" size={8} wrap>
        <Tag>{tools.length} 个已发现</Tag>
        <Tag color="blue">{tools.filter((tool) => tool.enabled).length} 个已启用</Tag>
        {server?.protocolVersion ? <Tag>协议 {server.protocolVersion}</Tag> : null}
      </Space>
      <Alert
        className="mcpToolNotice"
        message="新发现的工具默认停用。确认用途和风险后再启用，启用后才会出现在 Agent 工具绑定中。"
        showIcon
        type="info"
      />
      <Table<McpServerTool>
        columns={columns}
        dataSource={tools}
        loading={loading}
        locale={{ emptyText: <Empty description="尚未同步工具" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 680 }}
      />
    </Drawer>
  );
}
