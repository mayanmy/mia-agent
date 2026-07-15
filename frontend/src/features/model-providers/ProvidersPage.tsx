import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Empty, Input } from "antd";
import {
  checkModelCapability,
  createModelConfig,
  createProvider,
  deleteModelConfig,
  deleteProvider,
  getDefaultModelSettings,
  listProviderModels,
  listModelConfigs,
  listProviders,
  testProviderConnection,
  updateDefaultModelSettings,
  updateModelConfig,
  updateProvider,
  type ModelConfigListItem,
  type ProviderRemoteModel,
  type ProviderListItem
} from "./api";
import { DefaultModelSettingsModal } from "./components/DefaultModelSettingsModal";
import { ModelConfigModal } from "./components/ModelConfigModal";
import { ProviderCard } from "./components/ProviderCard";
import { ProviderFormModal } from "./components/ProviderFormModal";
import { ProviderMarketplace } from "./components/ProviderMarketplace";
import type {
  DefaultModelFormValues,
  ModelFormValues,
  ProviderFormValues,
  ProviderTemplate
} from "./types";
import {
  buildModelSelectOptions,
  modelDefaults,
  providerDefaults,
  providerTemplates,
  providerTypeLabels,
  toModelConfigPayload,
  toProviderPayload
} from "./utils";
import "./providers.less";

export function ProvidersPage() {
  const { message: messageApi } = AntdApp.useApp();
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [defaultModelDialogOpen, setDefaultModelDialogOpen] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<ProviderRemoteModel[]>([]);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingProviderApiKeyMasked, setEditingProviderApiKeyMasked] = useState("");
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [providerInitialValues, setProviderInitialValues] =
    useState<ProviderFormValues>(providerDefaults);
  const [modelInitialValues, setModelInitialValues] = useState<ModelFormValues>(modelDefaults);
  const [defaultModelInitialValues, setDefaultModelInitialValues] =
    useState<DefaultModelFormValues>({});
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(() => new Set());

  const providerOptions = useMemo(
    () => providers.map((provider) => ({ label: provider.name, value: provider.id })),
    [providers]
  );

  const chatModelOptions = useMemo(
    () => buildModelSelectOptions(modelConfigs, providers, "CHAT"),
    [modelConfigs, providers]
  );

  const embeddingModelOptions = useMemo(
    () => buildModelSelectOptions(modelConfigs, providers, "EMBEDDING"),
    [modelConfigs, providers]
  );

  const remoteModelOptions = useMemo(
    () =>
      remoteModels.map((model) => ({
        label: `${model.modelName}${model.capabilities.length > 0 ? ` · ${model.capabilities.join("/")}` : ""}${
          model.contextLength ? ` · ${model.contextLength}` : ""
        }`,
        value: model.modelName
      })),
    [remoteModels]
  );

  const filteredProviders = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return providers;
    }

    return providers.filter((provider) => {
      const models = modelConfigs.filter((model) => model.providerId === provider.id);
      return (
        provider.name.toLowerCase().includes(keyword) ||
        providerTypeLabels[provider.providerType].toLowerCase().includes(keyword) ||
        models.some((model) => model.modelName.toLowerCase().includes(keyword))
      );
    });
  }, [modelConfigs, providers, search]);

  async function refresh(isActive: () => boolean = () => true) {
    if (!isActive()) {
      return;
    }

    setLoading(true);

    try {
      const [providerPage, modelConfigPage] = await Promise.all([
        listProviders(1, 100),
        listModelConfigs(1, 100)
      ]);
      if (isActive()) {
        setProviders(providerPage.list);
        setModelConfigs(modelConfigPage.list);
      }
    } catch (error) {
      if (isActive()) {
        messageApi.error(error instanceof Error ? error.message : "加载模型供应商失败");
      }
    } finally {
      if (isActive()) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let disposed = false;
    void refresh(() => !disposed);

    return () => {
      disposed = true;
    };
  }, []);

  function openCreateProvider(template?: ProviderTemplate) {
    setEditingProviderId(null);
    setEditingProviderApiKeyMasked("");
    setProviderInitialValues(
      template
        ? {
            name: template.name,
            providerType: template.providerType,
            baseUrl: template.baseUrl,
            apiKey: "",
            enabled: true
          }
        : providerDefaults
    );
    setProviderDialogOpen(true);
  }

  function openEditProvider(provider: ProviderListItem) {
    setEditingProviderId(provider.id);
    setEditingProviderApiKeyMasked(provider.apiKeyMasked);
    setProviderInitialValues({
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: "",
      enabled: provider.enabled
    });
    setProviderDialogOpen(true);
  }

  function openCreateModel(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    setEditingModelId(null);
    setRemoteModels([]);
    setModelInitialValues({
      ...modelDefaults,
      providerId,
      credentialName: provider ? `${provider.name} 默认凭据` : "",
      baseUrl: provider?.baseUrl ?? ""
    });
    setModelDialogOpen(true);
    void syncProviderModels(providerId);
  }

  function openEditModel(config: ModelConfigListItem) {
    const provider = providers.find((item) => item.id === config.providerId);
    setEditingModelId(config.id);
    setRemoteModels([]);
    setModelInitialValues({
      providerId: config.providerId,
      modelName: config.modelName,
      modelType: config.modelType,
      credentialName: config.credentialName,
      baseUrl: provider?.baseUrl ?? "",
      apiKey: "",
      contextLength: config.contextLength,
      embeddingDimension: config.embeddingDimension,
      timeoutSeconds: config.timeoutSeconds,
      maxTokens: config.maxTokens,
      enabled: config.enabled
    });
    setModelDialogOpen(true);
  }

  async function openDefaultModelDialog() {
    setLoading(true);

    try {
      const settings = await getDefaultModelSettings();
      setDefaultModelInitialValues({
        chatModelConfigId: settings.chatModelConfigId,
        embeddingModelConfigId: settings.embeddingModelConfigId
      });
      setDefaultModelDialogOpen(true);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "加载默认模型设置失败");
    } finally {
      setLoading(false);
    }
  }

  function toggleProviderModels(providerId: string) {
    setExpandedProviderIds((current) => {
      const next = new Set(current);

      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }

      return next;
    });
  }

  async function submitProvider(values: ProviderFormValues) {
    setSaving(true);

    try {
      const payload = toProviderPayload(values, Boolean(editingProviderId));
      if (editingProviderId) {
        await updateProvider(editingProviderId, payload);
        messageApi.success("供应商已更新");
      } else {
        await createProvider(payload);
        messageApi.success("供应商已安装");
      }
      setProviderDialogOpen(false);
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存供应商失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitModel(values: ModelFormValues) {
    setSaving(true);

    try {
      const provider = providers.find((item) => item.id === values.providerId);
      const baseUrl = values.baseUrl.trim();
      const apiKey = values.apiKey?.trim();

      if (provider && (baseUrl !== provider.baseUrl || apiKey)) {
        await updateProvider(provider.id, {
          name: provider.name,
          providerType: provider.providerType,
          baseUrl,
          apiKey: apiKey || undefined,
          enabled: provider.enabled
        });
      }

      const payload = toModelConfigPayload(values);
      const capability = await checkModelCapability({
        providerId: payload.providerId,
        modelName: payload.modelName,
        modelType: payload.modelType
      });

      if (capability.verified && !capability.supported) {
        messageApi.error(capability.message);
        return;
      }

      if (!capability.verified) {
        messageApi.warning(`模型能力未确认：${capability.message}`);
      }

      if (editingModelId) {
        await updateModelConfig(editingModelId, payload);
        messageApi.success("模型已更新");
      } else {
        await createModelConfig(payload);
        messageApi.success("模型已添加");
      }
      setModelDialogOpen(false);
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存模型失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitDefaultModelSettings(values: DefaultModelFormValues) {
    setSaving(true);

    try {
      await updateDefaultModelSettings({
        chatModelConfigId: values.chatModelConfigId ?? null,
        embeddingModelConfigId: values.embeddingModelConfigId ?? null
      });
      messageApi.success("默认模型设置已保存");
      setDefaultModelDialogOpen(false);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存默认模型设置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestProvider(providerId: string) {
    setLoading(true);

    try {
      const result = await testProviderConnection(providerId);
      messageApi[result.ok ? "success" : "error"](
        result.ok ? `连接正常，耗时 ${result.latencyMs}ms` : `连接失败：${result.statusText}`
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "测试连接失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProvider(providerId: string) {
    setLoading(true);

    try {
      await deleteProvider(providerId);
      messageApi.success("供应商已删除");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除供应商失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteModel(modelId: string) {
    setLoading(true);

    try {
      await deleteModelConfig(modelId);
      messageApi.success("模型已删除");
      await refresh();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除模型失败");
    } finally {
      setLoading(false);
    }
  }

  function handleModelProviderChange() {
    setRemoteModels([]);
  }

  async function syncProviderModels(providerId?: string) {
    if (!providerId) {
      messageApi.warning("请先选择供应商");
      return;
    }

    setSyncingModels(true);

    try {
      const models = await listProviderModels(providerId);
      setRemoteModels(models);
      messageApi.success(`已同步 ${models.length} 个模型`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "同步模型列表失败");
    } finally {
      setSyncingModels(false);
    }
  }

  return (
    <section className="workspace providersWorkspace">
      <header className="providersHero">
        <div>
          <h1>模型供应商</h1>
          <p>选择一个为应用提供能力的语言模型。在工作室中开始构建前，至少需要配置一个。</p>
        </div>
        <div className="providersHeroActions">
          <Button onClick={() => void openDefaultModelDialog()}>默认模型设置</Button>
          <Button onClick={() => void refresh()}>
            自动更新 <span className="latestBadge">最新</span>
          </Button>
        </div>
      </header>

      <div className="providerToolbar">
        <Input.Search
          allowClear
          placeholder="搜索模型..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="primary" onClick={() => openCreateProvider()}>
          安装
        </Button>
      </div>

      <div className="providerInstalledList" aria-busy={loading}>
        {filteredProviders.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            modelConfigs={modelConfigs}
            expandedProviderIds={expandedProviderIds}
            onEditProvider={openEditProvider}
            onTestProvider={handleTestProvider}
            onCreateModel={openCreateModel}
            onDeleteProvider={handleDeleteProvider}
            toggleProviderModels={toggleProviderModels}
            onEditModel={openEditModel}
            onDeleteModel={handleDeleteModel}
          />
        ))}

        {filteredProviders.length === 0 && (
          <Card>
            <Empty description="暂无匹配的模型供应商" />
          </Card>
        )}
      </div>

      <ProviderMarketplace templates={providerTemplates} onCreateProvider={openCreateProvider} />

      <DefaultModelSettingsModal
        initialValues={defaultModelInitialValues}
        saving={saving}
        open={defaultModelDialogOpen}
        chatModelOptions={chatModelOptions}
        embeddingModelOptions={embeddingModelOptions}
        onCancel={() => setDefaultModelDialogOpen(false)}
        onSubmit={(values) => void submitDefaultModelSettings(values)}
      />

      <ProviderFormModal
        initialValues={providerInitialValues}
        saving={saving}
        editingProviderId={editingProviderId}
        open={providerDialogOpen}
        editingProviderApiKeyMasked={editingProviderApiKeyMasked}
        onCancel={() => {
          setProviderDialogOpen(false);
          setEditingProviderApiKeyMasked("");
        }}
        onSubmit={(values) => void submitProvider(values)}
      />

      <ModelConfigModal
        initialValues={modelInitialValues}
        saving={saving}
        open={modelDialogOpen}
        editingModelId={editingModelId}
        providers={providers}
        providerOptions={providerOptions}
        remoteModels={remoteModels}
        remoteModelOptions={remoteModelOptions}
        syncingModels={syncingModels}
        onCancel={() => setModelDialogOpen(false)}
        onModelProviderChange={handleModelProviderChange}
        onSubmit={(values) => void submitModel(values)}
        onSyncProviderModels={(providerId) => void syncProviderModels(providerId)}
      />
    </section>
  );
}
