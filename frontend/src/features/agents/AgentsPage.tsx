import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Modal, Space, message } from "antd";

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
  updateAgentTools
} from "./api";
import { AgentEmbedModal } from "./components/AgentEmbedModal";
import { AgentFormModal } from "./components/AgentFormModal";
import { AgentTable } from "./components/AgentTable";
import type { AgentFormValues, AgentTableItem, EmbedScenario } from "./types";
import { defaultAgentFormValues, toAgentFormValues, toAgentPayload } from "./utils/agent-form";
import { getEmbedCode, getShareUrl } from "./utils/embed-code";
import "./agents.less";

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
  const [loadedToolIds, setLoadedToolIds] = useState<string[]>([]);
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

  useEffect(() => {
    void refresh(1, pagination.pageSize);
  }, []);

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

  function openCreateDialog() {
    setEditingId(null);
    setLoadedToolIds([]);
    form.setFieldsValue({
      ...defaultAgentFormValues,
      modelConfigId: resolveDefaultChatModelConfigId()
    });
    setDialogOpen(true);
  }

  function resolveDefaultChatModelConfigId(): string {
    const defaultModelAvailable = modelConfigs.some(
      (config) =>
        config.id === defaultChatModelConfigId && config.modelType === "CHAT" && config.enabled
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
      setLoadedToolIds(bindings.toolIds);
      form.setFieldsValue({
        ...toAgentFormValues(agent),
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
      const payload = toAgentPayload(values);
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
        await updateAgentTools(agentId, resolveSubmittedToolIds(values.toolIds));
      }

      setDialogOpen(false);
      setEditingId(null);
      setLoadedToolIds([]);
      form.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存 Agent 失败");
    } finally {
      setSaving(false);
    }
  }

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

  function confirmPublish(id: string) {
    Modal.confirm({
      title: "发布 Agent",
      content: "确认发布这个 Agent？",
      okText: "发布",
      okButtonProps: {
        danger: true
      },
      cancelText: "取消",
      onOk: () => handlePublish(id)
    });
  }

  async function handlePublish(id: string) {
    setLoading(true);

    try {
      const result = await publishAgent(id);
      message.success("Agent 已发布");
      await copyText(getShareUrl(window.location.origin, result.shareToken));
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发布 Agent 失败");
    } finally {
      setLoading(false);
    }
  }

  function confirmUnpublish(id: string) {
    Modal.confirm({
      title: "取消发布 Agent",
      content: "确认取消发布这个 Agent？",
      okText: "取消发布",
      okButtonProps: {
        danger: true
      },
      cancelText: "取消",
      onOk: () => handleUnpublish(id)
    });
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
    await copyText(getShareUrl(window.location.origin, agent.shareToken));
  }

  function openEmbedDialog(agent: AgentTableItem) {
    if (!agent.shareToken) {
      message.warning("请先发布 Agent");
      return;
    }

    setEmbedScenario("single");
    setEmbedAgent(agent);
  }

  async function copyEmbedCode() {
    await copyText(
      getEmbedCode({
        origin: window.location.origin,
        shareToken: embedAgent?.shareToken ?? null,
        scenario: embedScenario,
        agentName: embedAgent?.name
      })
    );
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
    setLoadedToolIds([]);
    form.resetFields();
  }

  function resolveSubmittedToolIds(value: AgentFormValues["toolIds"] | undefined): string[] {
    const fieldValue = value ?? form.getFieldValue("toolIds");

    if (Array.isArray(fieldValue)) {
      return fieldValue;
    }

    return editingId ? loadedToolIds : [];
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

      <AgentTable
        agents={agents}
        loading={loading}
        pagination={pagination}
        onCopyLink={(agent) => void copyShareLink(agent)}
        onDelete={confirmDelete}
        onEdit={(id) => void openEditDialog(id)}
        onOpenEmbed={openEmbedDialog}
        onPageChange={(page, pageSize) => void refresh(page, pageSize)}
        onPublish={confirmPublish}
        onTest={(agentId) => navigate(`/chat?agentId=${agentId}`)}
        onUnpublish={confirmUnpublish}
      />

      <AgentFormModal
        editing={Boolean(editingId)}
        form={form}
        modelOptions={modelOptions}
        open={dialogOpen}
        saving={saving}
        tools={tools}
        onCancel={closeDialog}
        onSubmit={(values) => void handleSubmit(values)}
      />

      <AgentEmbedModal
        agent={embedAgent}
        origin={window.location.origin}
        scenario={embedScenario}
        onCancel={() => setEmbedAgent(null)}
        onCopy={() => void copyEmbedCode()}
        onScenarioChange={setEmbedScenario}
      />
    </section>
  );
}
