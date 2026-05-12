import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Checkbox,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Slider,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message
} from "antd";
import type { MenuProps, TableProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

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

type EmbedScenario = "single" | "multi" | "spa" | "inline";

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
  const [embedAgent, setEmbedAgent] = useState<AgentTableItem | null>(null);
  const [embedScenario, setEmbedScenario] = useState<EmbedScenario>("single");
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
      width: 160,
      render: (_, record) => {
        const menuItems: MenuProps["items"] = [
          record.published
            ? {
                key: "copy",
                label: "复制链接"
              }
            : {
                key: "publish",
                label: "发布"
              },
          ...(record.published
            ? [
                {
                  key: "embed",
                  label: "嵌入代码"
                },
                {
                  key: "unpublish",
                  label: "取消发布"
                }
              ]
            : []),
          {
            type: "divider"
          },
          {
            key: "edit",
            label: "编辑"
          },
          {
            key: "delete",
            label: "删除",
            danger: true
          }
        ];

        const handleMenuClick: MenuProps["onClick"] = ({ key }) => {
          if (key === "publish") {
            void handlePublish(record.id);
            return;
          }

          if (key === "copy") {
            void copyShareLink(record);
            return;
          }

          if (key === "embed") {
            openEmbedDialog(record);
            return;
          }

          if (key === "unpublish") {
            void handleUnpublish(record.id);
            return;
          }

          if (key === "edit") {
            void openEditDialog(record.id);
            return;
          }

          if (key === "delete") {
            confirmDelete(record.id);
          }
        };

        return (
          <Space className="agentActionCell" size={4}>
            <Button type="link" size="small" onClick={() => navigate(`/chat?agentId=${record.id}`)}>
              测试对话
            </Button>
            <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={["click"]}>
              <Button aria-label="更多操作" icon={<MoreOutlined />} size="small" type="text" />
            </Dropdown>
          </Space>
        );
      }
    }
  ];

  function confirmDelete(id: string) {
    Modal.confirm({
      title: "删除 Agent",
      content: "确认删除这个 Agent？",
      okText: "删除",
      okButtonProps: {
        danger: true
      },
      cancelText: "取消",
      onOk: () => handleDelete(id)
    });
  }

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

  function openEmbedDialog(agent: AgentTableItem) {
    if (!agent.shareToken) {
      message.warning("请先发布 Agent");
      return;
    }

    setEmbedScenario("single");
    setEmbedAgent(agent);
  }

  function getShareUrl(shareToken: string | null): string {
    if (!shareToken) {
      return "";
    }

    return `${window.location.origin}/share/agents/${shareToken}`;
  }

  function getEmbedCode(shareToken: string | null, scenario = embedScenario): string {
    if (!shareToken) {
      return "";
    }

    if (scenario === "multi") {
      return getMultiAgentEmbedCode(shareToken);
    }

    if (scenario === "spa") {
      return getSpaEmbedCode(shareToken);
    }

    if (scenario === "inline") {
      return getInlineEmbedCode(shareToken);
    }

    return getScriptTag(shareToken, embedAgent?.name);
  }

  function getScriptTag(shareToken: string, agentName?: string): string {
    const origin = window.location.origin;
    const nameAttribute = agentName ? ` data-agent-name="${escapeHtmlAttribute(agentName)}"` : "";

    return `<script src="${origin}/mia-agent-widget.js" data-agent-token="${shareToken}" data-api-base="${origin}"${nameAttribute} data-launcher-icon="M" data-launcher-size="56" async></script>`;
  }

  function getMultiAgentEmbedCode(shareToken: string): string {
    const origin = window.location.origin;
    const currentName = embedAgent?.name || "当前 Agent";

    return [
      "<!-- 同一页面可放多段 script，最终只会显示一个 Mia 入口，聊天框内可切换 Agent。 -->",
      getScriptTag(shareToken, currentName),
      `<script src="${origin}/mia-agent-widget.js" data-agent-token="另一个 Agent 的 shareToken" data-api-base="${origin}" data-agent-name="另一个 Agent 名称" async></script>`
    ].join("\n");
  }

  function getSpaEmbedCode(shareToken: string): string {
    const origin = window.location.origin;
    const currentName = escapeJsString(embedAgent?.name || "当前 Agent");

    return `<script>
function loadMiaAgentWidget(agent) {
  if (window.MiaAgentWidget && window.MiaAgentWidget.destroy) {
    window.MiaAgentWidget.destroy();
  }

  document.querySelectorAll("script[data-mia-widget-loader]").forEach(function (element) {
    element.remove();
  });

  var script = document.createElement("script");
  script.src = "${origin}/mia-agent-widget.js";
  script.async = true;
  script.setAttribute("data-mia-widget-loader", "true");
  script.setAttribute("data-api-base", "${origin}");
  script.setAttribute("data-agent-token", agent.token);
  script.setAttribute("data-agent-name", agent.name);
  script.setAttribute("data-launcher-icon", agent.icon || "M");
  script.setAttribute("data-launcher-size", String(agent.iconSize || 56));
  document.body.appendChild(script);
}

// 在路由变化时调用，传入当前页面对应的 Agent。
loadMiaAgentWidget({
  token: "${shareToken}",
  name: "${currentName}",
  icon: "M",
  iconSize: 56
});
</script>`;
  }

  function getInlineEmbedCode(shareToken: string): string {
    const origin = window.location.origin;
    const currentName = embedAgent?.name || "当前 Agent";

    return [
      '<div id="mia-agent-container" style="height: 600px;"></div>',
      "",
      `<script src="${origin}/mia-agent-widget.js" data-agent-token="${shareToken}" data-api-base="${origin}" data-agent-name="${escapeHtmlAttribute(currentName)}" data-mode="inline" data-container="#mia-agent-container" async></script>`
    ].join("\n");
  }

  function escapeHtmlAttribute(value: string): string {
    return value
      .replace(/&/gu, "&amp;")
      .replace(/"/gu, "&quot;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;");
  }

  function escapeJsString(value: string): string {
    return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
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

      <Modal
        destroyOnHidden
        okText="复制代码"
        open={Boolean(embedAgent)}
        title="嵌入代码"
        width={720}
        onCancel={() => setEmbedAgent(null)}
        onOk={() => void copyText(getEmbedCode(embedAgent?.shareToken ?? null))}
      >
        <Tabs
          activeKey={embedScenario}
          items={[
            {
              key: "single",
              label: "单页面单 Agent",
              children: (
                <EmbedCodePanel
                  code={getEmbedCode(embedAgent?.shareToken ?? null, "single")}
                  description='适合普通页面：每个页面只嵌入当前这个 Agent，页面右下角出现一个 Mia 聊天入口。可调整 data-launcher-icon 和 data-launcher-size；如果要用图片图标，改用 data-launcher-icon-url="https://..."。'
                />
              )
            },
            {
              key: "multi",
              label: "同页多 Agent",
              children: (
                <EmbedCodePanel
                  code={getEmbedCode(embedAgent?.shareToken ?? null, "multi")}
                  description="适合同一个页面需要多个 Agent：放多段 script，页面仍然只有一个入口，聊天框顶部用下拉框切换 Agent。"
                />
              )
            },
            {
              key: "spa",
              label: "SPA 路由切换",
              children: (
                <EmbedCodePanel
                  code={getEmbedCode(embedAgent?.shareToken ?? null, "spa")}
                  description="适合 React/Vue 等单页应用：路由变化时调用 loadMiaAgentWidget，先销毁旧 widget，再加载当前页面对应的 Agent。"
                />
              )
            },
            {
              key: "inline",
              label: "页面内嵌",
              children: (
                <EmbedCodePanel
                  code={getEmbedCode(embedAgent?.shareToken ?? null, "inline")}
                  description="适合把 Chat 作为页面内容的一部分：指定容器后直接渲染完整聊天框，不显示右下角悬浮按钮，也不支持拖动。"
                />
              )
            }
          ]}
          onChange={(key) => setEmbedScenario(key as EmbedScenario)}
        />
      </Modal>
    </section>
  );
}

function EmbedCodePanel({ code, description }: { code: string; description: string }) {
  return (
    <>
      <p className="embedCodeHint">{description}</p>
      <Input.TextArea readOnly autoSize={{ minRows: 7, maxRows: 14 }} value={code} />
    </>
  );
}
