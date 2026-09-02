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
      title: "输入脱敏路径",
      dataIndex: "sensitiveInputPaths",
      width: 220,
      render: (paths: string[], tool) => (
        <Select
          aria-label={`${tool.remoteName} 输入脱敏路径`}
          disabled={updatingToolId === tool.id}
          mode="tags"
          open={false}
          placeholder="如 customer.mobile"
          tokenSeparators={[",", "，"]}
          value={paths}
          onChange={(value) => onUpdate(tool, { sensitiveInputPaths: value })}
        />
      )
    },
    {
      title: "输出脱敏路径",
      dataIndex: "sensitiveOutputPaths",
      width: 220,
      render: (paths: string[], tool) => (
        <Select
          aria-label={`${tool.remoteName} 输出脱敏路径`}
          disabled={updatingToolId === tool.id}
          mode="tags"
          open={false}
          placeholder="如 result.token"
          tokenSeparators={[",", "，"]}
          value={paths}
          onChange={(value) => onUpdate(tool, { sensitiveOutputPaths: value })}
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
      width={1160}
      onClose={onClose}
    >
      <Space className="mcpToolDrawerSummary" size={8} wrap>
        <Tag>{tools.length} 个已发现</Tag>
        <Tag color="blue">{tools.filter((tool) => tool.enabled).length} 个已启用</Tag>
        {server?.protocolVersion ? <Tag>协议 {server.protocolVersion}</Tag> : null}
      </Space>
      <Alert
        className="mcpToolNotice"
        message="新工具默认停用。系统会自动脱敏 password、token、secret 等字段；业务敏感字段请用点路径或 JSON Pointer 补充，例如 customer.mobile 或 /customer/mobile。"
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
        scroll={{ x: 1080 }}
      />
    </Drawer>
  );
}
