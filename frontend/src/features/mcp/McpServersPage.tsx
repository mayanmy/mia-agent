import { useEffect, useState } from "react";
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  ToolOutlined
} from "@ant-design/icons";
import { App as AntdApp, Button, Form, Modal, Space, Table, Tag, Tooltip } from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  listMcpServerTools,
  syncMcpTools,
  testMcpConnection,
  updateMcpServer,
  updateMcpServerTool
} from "./api";
import type {
  McpServerFormValues,
  McpServerListItem,
  McpServerPayload,
  McpServerTool
} from "./api";
import { McpServerFormModal } from "./components/McpServerFormModal";
import { McpToolsDrawer } from "./components/McpToolsDrawer";
import "./mcp.less";

const DEFAULT_VALUES: McpServerFormValues = {
  name: "",
  slug: "",
  description: "",
  endpoint: "",
  authType: "none",
  headerName: "X-API-Key",
  enabled: true,
  allowPrivateNetwork: false,
  approvalMode: "auto",
  connectTimeoutMs: 10_000,
  toolTimeoutMs: 30_000,
  maxResponseBytes: 1_000_000,
  maxOutputChars: 20_000,
  maxConcurrency: 3
};

export function McpServersPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<McpServerFormValues>();
  const [servers, setServers] = useState<McpServerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [toolServer, setToolServer] = useState<McpServerListItem | null>(null);
  const [tools, setTools] = useState<McpServerTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [updatingToolId, setUpdatingToolId] = useState<string | null>(null);

  useEffect(() => {
    void refreshServers();
  }, []);

  async function refreshServers() {
    setLoading(true);
    try {
      setServers(await listMcpServers());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 MCP Server 失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setSecretConfigured(false);
    form.setFieldsValue(DEFAULT_VALUES);
    setFormOpen(true);
  }

  async function openEdit(server: McpServerListItem) {
    setLoading(true);
    try {
      const detail = await getMcpServer(server.id);
      setEditingId(server.id);
      setSecretConfigured(detail.secretConfigured);
      form.setFieldsValue({
        ...detail,
        headerName:
          typeof detail.authConfig.headerName === "string"
            ? detail.authConfig.headerName
            : "X-API-Key",
        secret: undefined
      });
      setFormOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 MCP Server 失败");
    } finally {
      setLoading(false);
    }
  }

  /** 前端表单中的 Header 名转换为后端结构化 authConfig，凭据留空时不会覆盖旧值。 */
  async function submit(values: McpServerFormValues) {
    setSaving(true);
    try {
      const { headerName, ...rest } = values;
      const payload: McpServerPayload = {
        ...rest,
        secret: values.secret || undefined,
        authConfig: values.authType === "api_key_header" ? { headerName } : {}
      };
      if (editingId) {
        await updateMcpServer(editingId, payload);
        message.success("MCP Server 已更新");
      } else {
        await createMcpServer(payload);
        message.success("MCP Server 已创建");
      }
      setFormOpen(false);
      form.resetFields();
      await refreshServers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存 MCP Server 失败");
    } finally {
      setSaving(false);
    }
  }

  async function runConnectionTest(server: McpServerListItem) {
    setActiveAction(`test:${server.id}`);
    try {
      const result = await testMcpConnection(server.id);
      if (result.ok) {
        message.success(`连接成功，发现 ${result.toolCount ?? 0} 个工具`);
      } else {
        message.error(result.errorMessage || "连接测试失败");
      }
      await refreshServers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setActiveAction(null);
    }
  }

  async function runSync(server: McpServerListItem) {
    setActiveAction(`sync:${server.id}`);
    try {
      const result = await syncMcpTools(server.id);
      if (result.status === "completed") {
        message.success(`同步完成：${result.toolCount} 个工具，${result.schemaChangedCount} 个变更`);
      } else {
        message.error(result.errorMessage || "工具同步失败");
      }
      await refreshServers();
      if (toolServer?.id === server.id) await openTools(server);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "工具同步失败");
    } finally {
      setActiveAction(null);
    }
  }

  async function openTools(server: McpServerListItem) {
    setToolServer(server);
    setToolsLoading(true);
    try {
      setTools(await listMcpServerTools(server.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 MCP 工具失败");
    } finally {
      setToolsLoading(false);
    }
  }

  async function updateTool(tool: McpServerTool, changes: Partial<McpServerTool>) {
    if (!toolServer) return;
    setUpdatingToolId(tool.id);
    try {
      const updated = await updateMcpServerTool(toolServer.id, tool.id, {
        enabled: changes.enabled ?? tool.enabled,
        riskLevel: changes.riskLevel ?? tool.riskLevel,
        approvalMode: tool.approvalMode ?? null
      });
      setTools((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await refreshServers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新 MCP 工具失败");
    } finally {
      setUpdatingToolId(null);
    }
  }

  function confirmDelete(server: McpServerListItem) {
    Modal.confirm({
      title: "删除 MCP Server",
      content: `删除“${server.name}”后，已绑定的远程工具将立即停止执行。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await deleteMcpServer(server.id);
        message.success("MCP Server 已删除");
        await refreshServers();
      }
    });
  }

  const columns: TableProps<McpServerListItem>["columns"] = [
    {
      title: "Server",
      width: 220,
      render: (_, server) => (
        <div className="mcpServerIdentity">
          <strong>{server.name}</strong>
          <span>{server.slug}</span>
        </div>
      )
    },
    {
      title: "Endpoint",
      dataIndex: "endpoint",
      ellipsis: true,
      render: (endpoint: string) => <code className="mcpEndpoint">{endpoint}</code>
    },
    {
      title: "鉴权",
      width: 150,
      render: (_, server) => (
        <Tag color={server.authType === "none" || server.secretConfigured ? "green" : "red"}>
          {formatAuth(server)}
        </Tag>
      )
    },
    {
      title: "健康",
      dataIndex: "healthStatus",
      width: 112,
      render: (status: string, server) => (
        <Tooltip title={server.lastErrorMessage}>
          <Tag color={healthColor(status)}>{healthLabel(status)}</Tag>
        </Tooltip>
      )
    },
    {
      title: "工具",
      width: 108,
      render: (_, server) => `${server.enabledToolCount} / ${server.toolCount}`
    },
    {
      title: "最近同步",
      dataIndex: "lastDiscoveredAt",
      width: 170,
      render: (value?: string) => (value ? new Date(value).toLocaleString() : "尚未同步")
    },
    {
      title: "操作",
      fixed: "right",
      width: 260,
      render: (_, server) => (
        <Space size={0}>
          <Tooltip title="测试连接">
            <Button
              icon={<ApiOutlined />}
              loading={activeAction === `test:${server.id}`}
              type="text"
              onClick={() => void runConnectionTest(server)}
            />
          </Tooltip>
          <Tooltip title="同步工具">
            <Button
              icon={<SyncOutlined />}
              loading={activeAction === `sync:${server.id}`}
              type="text"
              onClick={() => void runSync(server)}
            />
          </Tooltip>
          <Tooltip title="工具目录">
            <Button icon={<ToolOutlined />} type="text" onClick={() => void openTools(server)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button icon={<EditOutlined />} type="text" onClick={() => void openEdit(server)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button
              danger
              icon={<DeleteOutlined />}
              type="text"
              onClick={() => confirmDelete(server)}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace mcpWorkspace">
      <WorkspacePageHeader
        actions={
          <>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshServers()}>
              刷新
            </Button>
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
              新增 Server
            </Button>
          </>
        }
        description="连接可信 MCP Server，同步并治理可供 Agent 使用的远程工具。"
        title="MCP"
      />
      <section className="panel mcpTablePanel">
        <Table<McpServerListItem>
          columns={columns}
          dataSource={servers}
          loading={loading}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1240 }}
        />
      </section>
      <McpServerFormModal
        editing={Boolean(editingId)}
        form={form}
        open={formOpen}
        saving={saving}
        secretConfigured={secretConfigured}
        onCancel={() => {
          setFormOpen(false);
          form.resetFields();
        }}
        onSubmit={(values) => void submit(values)}
      />
      <McpToolsDrawer
        loading={toolsLoading}
        server={toolServer}
        tools={tools}
        updatingToolId={updatingToolId}
        onClose={() => setToolServer(null)}
        onUpdate={(tool, changes) => void updateTool(tool, changes)}
      />
    </section>
  );
}

function formatAuth(server: McpServerListItem): string {
  if (server.authType === "none") return "无鉴权";
  const label = server.authType === "bearer" ? "Bearer" : "API Key";
  return `${label} · ${server.secretConfigured ? "已配置" : "缺凭据"}`;
}

function healthColor(status: string): string {
  if (status === "healthy") return "green";
  if (status === "connecting" || status === "degraded") return "orange";
  if (status === "auth_required" || status === "unavailable") return "red";
  return "default";
}

function healthLabel(status: string): string {
  const labels: Record<string, string> = {
    unknown: "未检测",
    connecting: "连接中",
    healthy: "健康",
    degraded: "降级",
    unavailable: "不可用",
    auth_required: "需鉴权"
  };
  return labels[status] ?? status;
}
