import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message
} from "antd";
import type { TableProps } from "antd";

import { listModelConfigs, listProviders } from "../model-providers/api";
import type { ModelConfigListItem, ProviderListItem } from "../model-providers/api";
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
  type AgentDetail,
  type AgentListItem,
  type AgentPayload
} from "./api";

type AgentFormValues = {
  name: string;
  description?: string;
  modelConfigId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens?: number | null;
  historyTurns: number;
  enabled: boolean;
  toolIds: string[];
};

type AgentTableItem = AgentListItem & {
  toolCount: number;
};

const defaultFormValues: AgentFormValues = {
  name: "",
  description: "",
  modelConfigId: "",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: null,
  historyTurns: 6,
  enabled: true,
  toolIds: []
};

const builtinTools = [
  { label: "HTTP 请求", value: "http_request" },
  { label: "计算器", value: "calculator" },
  { label: "当前时间", value: "current_time" }
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function toPayload(values: AgentFormValues): AgentPayload {
  return {
    name: values.name.trim(),
    description: values.description?.trim() || "",
    modelConfigId: values.modelConfigId,
    systemPrompt: values.systemPrompt.trim(),
    temperature: values.temperature,
    maxTokens: values.maxTokens ?? null,
    historyTurns: values.historyTurns,
    enabled: values.enabled
  };
}

function toFormValues(agent: AgentDetail): AgentFormValues {
  return {
    name: agent.name,
    description: agent.description,
    modelConfigId: agent.modelConfigId,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    historyTurns: agent.historyTurns,
    enabled: agent.enabled,
    toolIds: []
  };
}

export function AgentsPage() {
  const [form] = Form.useForm<AgentFormValues>();
  const [agents, setAgents] = useState<AgentTableItem[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const modelOptions = useMemo(() => {
    return providers
      .map((provider) => ({
        label: provider.name,
        options: modelConfigs
          .filter(
            (config) =>
              config.providerId === provider.id && config.modelType === "CHAT" && config.enabled
          )
          .map((config) => ({
            label: config.modelName,
            value: config.id
          }))
      }))
      .filter((group) => group.options.length > 0);
  }, [modelConfigs, providers]);

  const columns: TableProps<AgentTableItem>["columns"] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      fixed: "left",
      width: 180
    },
    {
      title: "关联模型名",
      dataIndex: "modelName",
      key: "modelName",
      width: 180,
      render: (_, record) => `${record.providerName} / ${record.modelName}`
    },
    {
      title: "工具数量",
      dataIndex: "toolCount",
      key: "toolCount",
      width: 100
    },
    {
      title: "temperature",
      dataIndex: "temperature",
      key: "temperature",
      width: 120
    },
    {
      title: "启用状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 110,
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatDate(createdAt)
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => void openEditDialog(record.id)}>
            编辑
          </Button>
          <Popconfirm
            title="删除 Agent"
            description="确认删除这个 Agent？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void handleDelete(record.id)}
          >
            <Button danger type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  async function refresh(nextPage = pagination.page, nextPageSize = pagination.pageSize) {
    setLoading(true);

    try {
      const [agentPage, providerPage, modelConfigPage] = await Promise.all([
        listAgents(nextPage, nextPageSize),
        listProviders(1, 100),
        listModelConfigs(1, 100)
      ]);

      setAgents(agentPage.list.map((agent) => ({ ...agent, toolCount: 0 })));
      setProviders(providerPage.list);
      setModelConfigs(modelConfigPage.list);
      setPagination({
        page: agentPage.page,
        pageSize: agentPage.pageSize,
        total: agentPage.total
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Agent 失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(1, pagination.pageSize);
  }, []);

  function openCreateDialog() {
    setEditingId(null);
    form.setFieldsValue({
      ...defaultFormValues,
      modelConfigId: modelOptions[0]?.options[0]?.value || ""
    });
    setDialogOpen(true);
  }

  async function openEditDialog(id: string) {
    setLoading(true);

    try {
      const agent = await getAgent(id);
      setEditingId(agent.id);
      form.setFieldsValue(toFormValues(agent));
      setDialogOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Agent 详情失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(values: AgentFormValues) {
    setSaving(true);

    try {
      const payload = toPayload(values);
      if (editingId) {
        await updateAgent(editingId, payload);
        message.success("Agent 已更新");
      } else {
        await createAgent(payload);
        message.success("Agent 已创建");
      }

      setDialogOpen(false);
      setEditingId(null);
      form.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存 Agent 失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setLoading(true);

    try {
      await deleteAgent(id);
      message.success("Agent 已删除");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除 Agent 失败");
    } finally {
      setLoading(false);
    }
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    form.resetFields();
  }

  return (
    <section className="workspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Agent</p>
          <h1>Agent 管理</h1>
        </div>
        <Space>
          <Button disabled={loading} onClick={() => void refresh()}>
            刷新
          </Button>
          <Button type="primary" onClick={openCreateDialog}>
            新增 Agent
          </Button>
        </Space>
      </header>

      <Table<AgentTableItem>
        columns={columns}
        dataSource={agents}
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true
        }}
        rowKey="id"
        scroll={{ x: 980 }}
        onChange={(nextPagination) => {
          void refresh(nextPagination.current || 1, nextPagination.pageSize || 20);
        }}
      />

      <Modal
        destroyOnHidden
        confirmLoading={saving}
        okText={editingId ? "保存" : "创建"}
        open={dialogOpen}
        title={editingId ? "编辑 Agent" : "新增 Agent"}
        width={760}
        onCancel={closeDialog}
        onOk={() => form.submit()}
      >
        <Form<AgentFormValues>
          form={form}
          initialValues={defaultFormValues}
          layout="vertical"
          onFinish={(values) => void handleSubmit(values)}
        >
          <Tabs
            items={[
              {
                key: "basic",
                label: "基础配置",
                children: (
                  <div className="agentFormGrid">
                    <Form.Item
                      label="名称"
                      name="name"
                      rules={[{ required: true, message: "请输入名称" }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      label="模型选择"
                      name="modelConfigId"
                      rules={[{ required: true, message: "请选择模型" }]}
                    >
                      <Select options={modelOptions} />
                    </Form.Item>
                    <Form.Item className="agentFormFull" label="描述" name="description">
                      <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
                    </Form.Item>
                    <Form.Item
                      className="agentFormFull"
                      label="System Prompt"
                      name="systemPrompt"
                      rules={[{ required: true, message: "请输入 System Prompt" }]}
                    >
                      <Input.TextArea autoSize={{ minRows: 6, maxRows: 12 }} />
                    </Form.Item>
                    <Form.Item
                      label="temperature"
                      name="temperature"
                      rules={[{ required: true, message: "请选择 temperature" }]}
                    >
                      <Slider min={0} max={1} step={0.1} marks={{ 0: "0", 1: "1" }} />
                    </Form.Item>
                    <Form.Item label="max_tokens" name="maxTokens">
                      <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item
                      label="max_context_turns"
                      name="historyTurns"
                      rules={[{ required: true, message: "请输入 max_context_turns" }]}
                    >
                      <InputNumber min={0} max={20} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item label="启用" name="enabled" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </div>
                )
              },
              {
                key: "tools",
                label: "工具绑定",
                children: (
                  <Form.Item name="toolIds">
                    <Checkbox.Group className="toolCheckboxGroup" options={builtinTools} />
                  </Form.Item>
                )
              }
            ]}
          />
        </Form>
      </Modal>
    </section>
  );
}
