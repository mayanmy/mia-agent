import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App as AntdApp, Button, Form, Modal } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { AgentsGuide } from "../../shared/components/menu-guides";

import { listKnowledgeBases, type KnowledgeBaseListItem } from "../knowledge/api";
import { listModelConfigOptions, type ModelConfigOption } from "../model-providers/api";
import { listSkillOptions, type SkillOption } from "../skills/api";
import { listTools, type ToolListItem } from "../tools/api";
import { listPublishedWorkflowApps, workflowToolId } from "../workflows/api";
import {
  createAgent,
  deleteAgent,
  getAgent,
  getAgentKnowledgeBases,
  getAgentSkills,
  getAgentTools,
  listAgents,
  publishAgent,
  unpublishAgent,
  updateAgent,
  updateAgentKnowledgeBases,
  updateAgentSkills,
  updateAgentTools
} from "./api";
import { AgentApiKeysModal } from "./components/AgentApiKeysModal";
import { AgentPublicAccessModal } from "./components/AgentPublicAccessModal";
import { AgentEmbedModal } from "./components/AgentEmbedModal";
import { AgentFormModal } from "./components/AgentFormModal";
import { AgentGallery } from "./components/AgentGallery";
import { AgentVersionsModal } from "./components/AgentVersionsModal";
import type { AgentFormValues, AgentTableItem, EmbedScenario } from "./types";
import { defaultAgentFormValues, toAgentFormValues, toAgentPayload } from "./utils/agent-form";
import { getEmbedCode, getShareUrl } from "./utils/embed-code";
import "./agents.less";

/** Agents 路由页，负责编排列表、编辑、绑定与发布流程。 */
export function AgentsPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<AgentFormValues>();
  const [agents, setAgents] = useState<AgentTableItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigOption[]>([]);
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseListItem[]>([]);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [defaultChatModelConfigId, setDefaultChatModelConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [embedAgent, setEmbedAgent] = useState<AgentTableItem | null>(null);
  const [apiKeyAgent, setApiKeyAgent] = useState<AgentTableItem | null>(null);
  const [publicAccessAgent, setPublicAccessAgent] = useState<AgentTableItem | null>(null);
  const [versionsAgent, setVersionsAgent] = useState<AgentTableItem | null>(null);
  const [embedScenario, setEmbedScenario] = useState<EmbedScenario>("iframe");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadedToolIds, setLoadedToolIds] = useState<string[]>([]);
  const [loadedKnowledgeBaseIds, setLoadedKnowledgeBaseIds] = useState<string[]>([]);
  const [loadedSkillIds, setLoadedSkillIds] = useState<string[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const modelOptions = useMemo(() => {
    return Array.from(new Map(modelConfigs.map((config) => [config.providerId, config])).values())
      .map((provider) => ({
        label: provider.providerName,
        options: modelConfigs
          .filter(
            (config) => config.providerId === provider.providerId && config.modelType === "CHAT"
          )
          .map((config) => ({
            label: config.modelName,
            value: config.id
          }))
      }))
      .filter((group) => group.options.length > 0);
  }, [modelConfigs]);

  useEffect(() => {
    let disposed = false;
    void refresh(1, pagination.pageSize, () => !disposed);

    return () => {
      disposed = true;
    };
  }, []);

  async function refresh(
    nextPage = pagination.page,
    nextPageSize = pagination.pageSize,
    isActive: () => boolean = () => true
  ) {
    if (!isActive()) {
      return;
    }

    setLoading(true);

    try {
      const [agentPage, modelConfigOptions, knowledgeBasePage, skillOptions] = await Promise.all([
        listAgents(nextPage, nextPageSize),
        listModelConfigOptions(),
        listKnowledgeBases(1, 100),
        listSkillOptions()
      ]);
      const [toolList, workflowApps] = await Promise.all([
        listTools(),
        listPublishedWorkflowApps()
      ]);

      if (isActive()) {
        setAgents(agentPage.list);
        setModelConfigs(modelConfigOptions);
        setKnowledgeBases(knowledgeBasePage.list);
        setSkills(skillOptions);
        setTools([
          ...toolList.map((tool) => ({ ...tool, source: "standard" as const })),
          ...workflowApps.map((app) => ({
            id: workflowToolId(app),
            name: app.name,
            description: app.description || `运行 Workflow v${app.version}`,
            enabled: true,
            source: "workflow" as const,
            workflowVersion: app.version
          }))
        ]);
        setDefaultChatModelConfigId(
          modelConfigOptions.find((config) => config.isDefault)?.id ?? null
        );
        setPagination({
          page: agentPage.page,
          pageSize: agentPage.pageSize,
          total: agentPage.total
        });
      }
    } catch (error) {
      if (isActive()) {
        message.error(error instanceof Error ? error.message : "加载 Agent 失败");
      }
    } finally {
      if (isActive()) {
        setLoading(false);
      }
    }
  }

  function openCreateDialog() {
    setEditingId(null);
    setLoadedToolIds([]);
    setLoadedKnowledgeBaseIds([]);
    setLoadedSkillIds([]);
    form.setFieldsValue({
      ...defaultAgentFormValues,
      modelConfigId: resolveDefaultChatModelConfigId()
    });
    setDialogOpen(true);
  }

  function resolveDefaultChatModelConfigId(): string {
    const defaultModelAvailable = modelConfigs.some(
      (config) => config.id === defaultChatModelConfigId && config.modelType === "CHAT"
    );

    if (defaultChatModelConfigId && defaultModelAvailable) {
      return defaultChatModelConfigId;
    }

    return modelOptions[0]?.options[0]?.value || "";
  }

  /** 打开编辑弹窗前并行读取完整详情及其绑定数据。 */
  async function openEditDialog(id: string) {
    setLoading(true);

    try {
      const [agent, toolBindings, knowledgeBaseBindings, skillBindings] = await Promise.all([
        getAgent(id),
        getAgentTools(id),
        getAgentKnowledgeBases(id),
        getAgentSkills(id)
      ]);
      setEditingId(agent.id);
      setLoadedToolIds(toolBindings.toolIds);
      setLoadedKnowledgeBaseIds(knowledgeBaseBindings.knowledgeBaseIds);
      const skillIds = skillBindings.skills.map((binding) => binding.skillId);
      setLoadedSkillIds(skillIds);
      form.setFieldsValue({
        ...toAgentFormValues(agent),
        toolIds: toolBindings.toolIds,
        knowledgeBaseIds: knowledgeBaseBindings.knowledgeBaseIds,
        skillIds
      });
      setDialogOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Agent 详情失败");
    } finally {
      setLoading(false);
    }
  }

  /**
   * 先保存 Agent 基础配置，再更新工具与知识库绑定。
   * 绑定使用独立模块接口，页面负责汇总失败并刷新服务端最终状态。
   */
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
        await Promise.all([
          updateAgentTools(agentId, resolveSubmittedToolIds(values.toolIds)),
          updateAgentKnowledgeBases(
            agentId,
            resolveSubmittedKnowledgeBaseIds(values.knowledgeBaseIds)
          ),
          updateAgentSkills(agentId, resolveSubmittedSkillIds(values.skillIds))
        ]);
      }

      setDialogOpen(false);
      setEditingId(null);
      setLoadedToolIds([]);
      setLoadedKnowledgeBaseIds([]);
      setLoadedSkillIds([]);
      form.resetFields();
      await refresh();
    } catch (error) {
      message.error(formatAgentSaveError(error));
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

  function confirmUnpublish(agent: AgentTableItem) {
    Modal.confirm({
      title: "取消发布 Agent",
      content: "确认取消发布这个 Agent？",
      okText: "取消发布",
      okButtonProps: {
        danger: true
      },
      cancelText: "取消",
      onOk: () => handleUnpublish(agent.id, agent.releaseRevision)
    });
  }

  async function handleUnpublish(id: string, expectedReleaseRevision: number) {
    setLoading(true);

    try {
      await unpublishAgent(id, {
        expectedReleaseRevision,
        reason: "管理端手动下线"
      });
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

    setEmbedScenario("iframe");
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

  function formatAgentSaveError(error: unknown): string {
    const messageText = error instanceof Error ? error.message : "";

    if (
      messageText.includes("unknown or disabled knowledgeBaseIds") ||
      messageText.includes("invalidKnowledgeBases")
    ) {
      return "保存失败：部分绑定知识库已停用、删除或不存在，请在知识库绑定页取消后再保存。";
    }

    return messageText || "保存 Agent 失败";
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setLoadedToolIds([]);
    setLoadedKnowledgeBaseIds([]);
    setLoadedSkillIds([]);
    form.resetFields();
  }

  function resolveSubmittedToolIds(value: AgentFormValues["toolIds"] | undefined): string[] {
    const fieldValue = value ?? form.getFieldValue("toolIds");

    if (Array.isArray(fieldValue)) {
      return fieldValue;
    }

    return editingId ? loadedToolIds : [];
  }

  function resolveSubmittedKnowledgeBaseIds(
    value: AgentFormValues["knowledgeBaseIds"] | undefined
  ): string[] {
    const fieldValue = value ?? form.getFieldValue("knowledgeBaseIds");

    if (Array.isArray(fieldValue)) {
      return fieldValue;
    }

    return editingId ? loadedKnowledgeBaseIds : [];
  }

  function resolveSubmittedSkillIds(value: AgentFormValues["skillIds"] | undefined): string[] {
    const fieldValue = value ?? form.getFieldValue("skillIds");
    return Array.isArray(fieldValue) ? fieldValue : editingId ? loadedSkillIds : [];
  }

  return (
    <section className="workspace agentWorkspace">
      <WorkspacePageHeader
        actions={
          <>
            <AgentsGuide />
            <Button disabled={loading} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button type="primary" onClick={openCreateDialog}>
              新增 Agent
            </Button>
          </>
        }
        description="创建、配置和发布团队内部 AI 助手。"
        title="Agent"
      />

      <AgentGallery
        agents={agents}
        loading={loading}
        pagination={pagination}
        onCopyLink={(agent) => void copyShareLink(agent)}
        onDelete={confirmDelete}
        onEdit={(id) => void openEditDialog(id)}
        onOpenEmbed={openEmbedDialog}
        onOpenApiKeys={setApiKeyAgent}
        onOpenPublicAccess={setPublicAccessAgent}
        onOpenVersions={setVersionsAgent}
        onPageChange={(page, pageSize) => void refresh(page, pageSize)}
        onPublish={confirmPublish}
        onTest={(agentId) => navigate(`/chat?agentId=${agentId}`)}
        onUnpublish={confirmUnpublish}
      />

      <AgentFormModal
        editing={Boolean(editingId)}
        form={form}
        modelConfigs={modelConfigs}
        modelOptions={modelOptions}
        knowledgeBases={knowledgeBases}
        skills={skills}
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
      <AgentApiKeysModal agent={apiKeyAgent} onCancel={() => setApiKeyAgent(null)} />
      <AgentPublicAccessModal
        agent={publicAccessAgent}
        onCancel={() => setPublicAccessAgent(null)}
        onTokenRotated={() => void refresh()}
      />
      <AgentVersionsModal
        agent={versionsAgent}
        open={Boolean(versionsAgent)}
        onChanged={async () => {
          await refresh();
          setVersionsAgent(null);
        }}
        onClose={() => setVersionsAgent(null)}
      />
    </section>
  );
}
