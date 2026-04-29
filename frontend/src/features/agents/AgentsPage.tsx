import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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

import { getDefaultModelSettings, listModelConfigs, listProviders } from "../model-providers/api";
import type { ModelConfigListItem, ProviderListItem } from "../model-providers/api";
import { listTools, type ToolListItem } from "../tools/api";
import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgentTools,
  listAgents,
  publishAgent,
  unpublishAgent,
  updateAgent,
  updateAgentTools,
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
    toolIds: agent.toolIds
  };
}

export function AgentsPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<AgentFormValues>();
  const [agents, setAgents] = useState<AgentTableItem[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [defaultChatModelConfigId, setDefaultChatModelConfigId] = useState<string | null>(null);
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

  const toolOptions = useMemo(
    () =>
      tools.map((tool) => ({
        label: (
          <div className="toolOption">
            <div className="toolOptionName">{tool.name}</div>
            <div className="toolOptionDescription">{tool.description}</div>
          </div>
        ),
        value: tool.id,
        disabled: !tool.enabled
      })),
    [tools]
  );

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
      title: "发布状态",
      dataIndex: "published",
      key: "published",
      width: 110,
      render: (published: boolean) => (
        <Tag color={published ? "blue" : "default"}>{published ? "已发布" : "未发布"}</Tag>
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
      width: 340,
      render: (_, record) => (
        <Space>
          <Button type="link" onClick={() => navigate(`/chat?agentId=${record.id}`)}>
            测试对话
          </Button>
          {record.published ? (
            <>
              <Button type="link" onClick={() => void copyShareLink(record)}>
                复制链接
              </Button>
              <Button type="link" onClick={() => void handleUnpublish(record.id)}>
                取消发布
              </Button>
            </>
          ) : (
            <Button type="link" onClick={() => void handlePublish(record.id)}>
              发布
            </Button>
          )}
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
      const [defaultSettings, toolList] = await Promise.all([
        getDefaultModelSettings().catch(() => null),
        listTools()
      ]);

      setAgents(agentPage.list);
      setProviders(providerPage.list);
      setModelConfigs(modelConfigPage.list);
      setTools(toolList);
      setDefaultChatModelConfigId(defaultSettings?.chatModelConfigId ?? null);
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
      modelConfigId: resolveDefaultChatModelConfigId()
    });
    setDialogOpen(true);
  }

  function resolveDefaultChatModelConfigId(): string {
    const defaultModelAvailable = modelConfigs.some(
      (config) =>
        config.id === defaultChatModelConfigId &&
        config.modelType === "CHAT" &&
        config.enabled
    );

    if (defaultChatModelConfigId && defaultModelAvailable) {
      return defaultChatModelConfigId;
    }

    return modelOptions[0]?.options[0]?.value || "";
  }

  async function openEditDialog(id: string) {
    setLoading(true);

    try {
      const [agent, bindings] = await Promise.all([getAgent(id), getAgentTools(id)]);
      setEditingId(agent.id);
      form.setFieldsValue({
        ...toFormValues(agent),
        toolIds: bindings.toolIds
      });
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
      let agentId = editingId;

      if (editingId) {
        const agent = await updateAgent(editingId, payload);
        agentId = agent.id;
        message.success("Agent 已更新");
      } else {
        const agent = await createAgent(payload);
        agentId = agent.id;
        message.success("Agent 已创建");
      }

      if (agentId) {
        await updateAgentTools(agentId, values.toolIds ?? []);
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

  async function handlePublish(id: string) {
    setLoading(true);

    try {
      const result = await publishAgent(id);
      message.success("Agent 已发布");
      await copyText(getShareUrl(result.shareToken));
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发布 Agent 失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnpublish(id: string) {
    setLoading(true);

    try {
      await unpublishAgent(id);
      message.success("Agent 已取消发布");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "取消发布失败");
    } finally {
      setLoading(false);
    }
  }

  async function copyShareLink(agent: AgentTableItem) {
    await copyText(getShareUrl(agent.shareToken));
  }

  function getShareUrl(shareToken: string | null): string {
    if (!shareToken) {
      return "";
    }

    return `${window.location.origin}/share/agents/${shareToken}`;
  }

  async function copyText(value: string) {
    if (!value) {
      message.warning("分享链接不存在，请重新发布");
      return;
    }

    await navigator.clipboard.writeText(value);
    message.success("分享链接已复制");
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
        scroll={{ x: 1200 }}
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
                    <Checkbox.Group className="toolCheckboxGroup" options={toolOptions} />
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
