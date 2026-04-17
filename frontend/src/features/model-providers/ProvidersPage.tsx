import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  message
} from "antd";

import {
  createModelConfig,
  createProvider,
  deleteModelConfig,
  deleteProvider,
  listModelConfigs,
  listProviders,
  testProviderConnection,
  updateModelConfig,
  updateProvider,
  type ModelConfigListItem,
  type ModelConfigPayload,
  type ModelConfigType,
  type ModelProviderType,
  type ProviderListItem,
  type ProviderPayload
} from "./api";

const providerTypes: ModelProviderType[] = ["OPENAI_COMPATIBLE", "OLLAMA", "ANTHROPIC", "GEMINI"];
const modelTypes: ModelConfigType[] = ["CHAT", "EMBEDDING"];

const providerTypeLabels: Record<ModelProviderType, string> = {
  OPENAI_COMPATIBLE: "OpenAI 兼容",
  OLLAMA: "Ollama",
  ANTHROPIC: "Claude / Anthropic",
  GEMINI: "Gemini"
};

const modelTypeLabels: Record<ModelConfigType, string> = {
  CHAT: "LLM",
  EMBEDDING: "TEXT EMBEDDING"
};

type ProviderFormValues = {
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
};

type ModelFormValues = {
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  credentialName: string;
  baseUrl: string;
  apiKey?: string;
  contextLength: number;
  timeoutSeconds: number;
  maxTokens?: number | null;
  enabled: boolean;
};

type ProviderTemplate = {
  name: string;
  author: string;
  downloads: string;
  description: string;
  providerType: ModelProviderType;
  baseUrl: string;
  logo: string;
  accent: string;
};

const providerTemplates: ProviderTemplate[] = [
  {
    name: "Ollama",
    author: "local",
    downloads: "本地",
    description: "本地运行的 Ollama 模型服务，适合内网部署和离线使用。",
    providerType: "OLLAMA",
    baseUrl: "http://127.0.0.1:11434",
    logo: "O",
    accent: "#111827"
  },
  {
    name: "OpenAI",
    author: "langgenius",
    downloads: "687,536",
    description: "OpenAI 当前的语言、嵌入、内容审核与音频模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.openai.com/v1",
    logo: "O",
    accent: "#16c784"
  },
  {
    name: "Anthropic",
    author: "langgenius",
    downloads: "173,537",
    description: "Anthropic 的强大模型。",
    providerType: "ANTHROPIC",
    baseUrl: "https://api.anthropic.com/v1",
    logo: "AI",
    accent: "#d6a170"
  },
  {
    name: "Amazon Bedrock",
    author: "langgenius",
    downloads: "84,126",
    description: "The models of Amazon Bedrock",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://bedrock-runtime.example.com/v1",
    logo: "B",
    accent: "#2f9e83"
  },
  {
    name: "Gemini",
    author: "langgenius",
    downloads: "347,369",
    description: "谷歌提供的 Gemini 模型。",
    providerType: "GEMINI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    logo: "✦",
    accent: "#4f7cff"
  },
  {
    name: "深度求索",
    author: "langgenius",
    downloads: "1,250,314",
    description: "DeepSeek 提供的模型，例如 deepseek-chat、deepseek-reasoner 等。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.deepseek.com/v1",
    logo: "DS",
    accent: "#536dfe"
  },
  {
    name: "通义千问",
    author: "langgenius",
    downloads: "312,806",
    description: "阿里云提供的通义千问 Qwen 系列模型。",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    logo: "Q",
    accent: "#6c5ce7"
  },
  {
    name: "Azure OpenAI",
    author: "langgenius",
    downloads: "204,153",
    description: "Azure OpenAI Service Model",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
    logo: "A",
    accent: "#1677ff"
  },
  {
    name: "Azure AI Studio",
    author: "langgenius",
    downloads: "33,367",
    description: "Azure AI Studio",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://YOUR_RESOURCE.services.ai.azure.com/models",
    logo: "AS",
    accent: "#3b82f6"
  },
  {
    name: "Cohere",
    author: "langgenius",
    downloads: "49,105",
    description: "Cohere",
    providerType: "OPENAI_COMPATIBLE",
    baseUrl: "https://api.cohere.com/v1",
    logo: "C",
    accent: "#3b6b57"
  }
];

const providerDefaults: ProviderFormValues = {
  name: "",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "",
  apiKey: "",
  enabled: true
};

const modelDefaults: ModelFormValues = {
  providerId: "",
  modelName: "",
  modelType: "CHAT",
  credentialName: "",
  baseUrl: "",
  apiKey: "",
  contextLength: 4096,
  timeoutSeconds: 120,
  maxTokens: null,
  enabled: true
};

function toProviderPayload(values: ProviderFormValues): ProviderPayload {
  return {
    name: values.name.trim(),
    providerType: values.providerType,
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey ?? "",
    enabled: values.enabled
  };
}

function toModelConfigPayload(values: ModelFormValues): ModelConfigPayload {
  return {
    providerId: values.providerId,
    modelName: values.modelName.trim(),
    modelType: values.modelType,
    credentialName: values.credentialName.trim(),
    contextLength: values.contextLength,
    timeoutSeconds: values.timeoutSeconds,
    maxTokens: values.maxTokens ?? null,
    enabled: values.enabled
  };
}

function getProviderLogo(provider: ProviderListItem): string {
  const template = providerTemplates.find(
    (item) => item.name.toLowerCase() === provider.name.toLowerCase()
  );

  return template?.logo || provider.name.slice(0, 2).toUpperCase();
}

function getProviderAccent(provider: ProviderListItem): string {
  const template = providerTemplates.find(
    (item) => item.name.toLowerCase() === provider.name.toLowerCase()
  );

  return template?.accent || "#2563eb";
}

export function ProvidersPage() {
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [modelForm] = Form.useForm<ModelFormValues>();
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelVisible, setModelVisible] = useState(false);

  const providerOptions = useMemo(
    () => providers.map((provider) => ({ label: provider.name, value: provider.id })),
    [providers]
  );

  const selectedModelProvider = Form.useWatch("providerId", modelForm);
  const modelProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedModelProvider),
    [providers, selectedModelProvider]
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

  async function refresh() {
    setLoading(true);

    try {
      const [providerPage, modelConfigPage] = await Promise.all([
        listProviders(1, 100),
        listModelConfigs(1, 100)
      ]);
      setProviders(providerPage.list);
      setModelConfigs(modelConfigPage.list);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载模型供应商失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openCreateProvider(template?: ProviderTemplate) {
    setEditingProviderId(null);
    providerForm.setFieldsValue(
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
    providerForm.setFieldsValue({
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
    modelForm.setFieldsValue({
      ...modelDefaults,
      providerId,
      credentialName: provider ? `${provider.name} 默认凭据` : "",
      baseUrl: provider?.baseUrl ?? ""
    });
    setModelDialogOpen(true);
  }

  function openEditModel(config: ModelConfigListItem) {
    const provider = providers.find((item) => item.id === config.providerId);
    setEditingModelId(config.id);
    modelForm.setFieldsValue({
      providerId: config.providerId,
      modelName: config.modelName,
      modelType: config.modelType,
      credentialName: config.credentialName,
      baseUrl: provider?.baseUrl ?? "",
      apiKey: "",
      contextLength: config.contextLength,
      timeoutSeconds: config.timeoutSeconds,
      maxTokens: config.maxTokens,
      enabled: config.enabled
    });
    setModelDialogOpen(true);
  }

  function showModel() {
    setModelVisible(!modelVisible);
  }

  async function submitProvider(values: ProviderFormValues) {
    setSaving(true);

    try {
      const payload = toProviderPayload(values);
      if (editingProviderId) {
        await updateProvider(editingProviderId, payload);
        message.success("供应商已更新");
      } else {
        await createProvider(payload);
        message.success("供应商已安装");
      }
      setProviderDialogOpen(false);
      providerForm.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存供应商失败");
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
      if (editingModelId) {
        await updateModelConfig(editingModelId, payload);
        message.success("模型已更新");
      } else {
        await createModelConfig(payload);
        message.success("模型已添加");
      }
      setModelDialogOpen(false);
      modelForm.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存模型失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestProvider(providerId: string) {
    setLoading(true);

    try {
      const result = await testProviderConnection(providerId);
      message[result.ok ? "success" : "error"](
        result.ok ? `连接正常，耗时 ${result.latencyMs}ms` : `连接失败：${result.statusText}`
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试连接失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProvider(providerId: string) {
    setLoading(true);

    try {
      await deleteProvider(providerId);
      message.success("供应商已删除");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除供应商失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteModel(modelId: string) {
    setLoading(true);

    try {
      await deleteModelConfig(modelId);
      message.success("模型已删除");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除模型失败");
    } finally {
      setLoading(false);
    }
  }

  function handleModelProviderChange(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    modelForm.setFieldsValue({
      baseUrl: provider?.baseUrl ?? "",
      credentialName: provider ? `${provider.name} 默认凭据` : ""
    });
  }

  return (
    <section className="workspace providersWorkspace">
      <header className="providersHero">
        <div>
          <h1>模型供应商</h1>
          <p>选择一个为应用提供能力的语言模型。在工作室中开始构建前，至少需要配置一个。</p>
        </div>
        <div className="providersHeroActions">
          <Button onClick={() => message.info("默认模型设置将在 Chat 模块接入后开放")}>
            默认模型设置
          </Button>
          <Button onClick={() => void refresh()}>自动更新 <span className="latestBadge">最新</span></Button>
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
        {filteredProviders.map((provider) => {
          const models = modelConfigs.filter((model) => model.providerId === provider.id);
          return (
            <Card className="providerInstalledCard" key={provider.id}>
              <div className="providerCardMain">
                <div
                  className="providerLogo"
                  style={{ backgroundColor: getProviderAccent(provider) }}
                >
                  {getProviderLogo(provider)}
                </div>
                <div className="providerCardBody">
                  <div className="providerTitleRow">
                    <strong>{provider.name}</strong>
                    <Tag>{providerTypeLabels[provider.providerType]}</Tag>
                    <span className="providerStatus">{provider.enabled ? "已启用" : "已停用"}</span>
                  </div>
                  <div className="providerCapabilityRow">
                    <Tag>LLM</Tag>
                    <Tag>TEXT EMBEDDING</Tag>
                    <Tag>RERANK</Tag>
                  </div>
                </div>
                <Space className="providerActions" wrap>
                  <Button size="small" onClick={() => openEditProvider(provider)}>
                    管理凭据
                  </Button>
                  <Button size="small" onClick={() => void handleTestProvider(provider.id)}>
                    测试
                  </Button>
                  <Button size="small" type="primary" onClick={() => openCreateModel(provider.id)}>
                    添加模型
                  </Button>
                  <Popconfirm
                    title="删除供应商"
                    description="确认删除这个供应商？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void handleDeleteProvider(provider.id)}
                  >
                    <Button danger size="small">
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>

              <div className="providerModelsRow">
                <Button className="showModelsText" size="small" type="text" onClick={() => showModel()}>
                  {modelVisible ? '隐藏模型' : '显示模型'}
                </Button>
                {modelVisible && <div className="providerModelChips">
                  {models.length === 0 && <span className="mutedInline">暂无模型</span>}
                  {models.map((model) => (
                    <div className="modelChip" key={model.id}>
                      <span className={model.enabled ? "modelDot enabled" : "modelDot"} />
                      <span>{model.modelName}</span>
                      <Tag>{modelTypeLabels[model.modelType]}</Tag>
                      <Button size="small" type="text" onClick={() => openEditModel(model)}>
                        配置
                      </Button>
                      <Popconfirm
                        title="删除模型"
                        description="确认删除这个模型？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={() => void handleDeleteModel(model.id)}
                      >
                        <Button danger size="small" type="text">
                          删除
                        </Button>
                      </Popconfirm>
                    </div>
                  ))}
                </div>}
              </div>
            </Card>
          );
        })}

        {filteredProviders.length === 0 && (
          <Card>
            <Empty description="暂无匹配的模型供应商" />
          </Card>
        )}
      </div>

      <div className="marketplaceHeader">
        <h2>安装模型供应商</h2>
      </div>

      <div className="marketplaceGrid">
        {providerTemplates.map((template) => (
          <Card
            className="marketplaceCard"
            hoverable
            key={template.name}
            onClick={() => openCreateProvider(template)}
          >
            <div className="marketplaceCardHeader">
              <div className="marketplaceLogo" style={{ backgroundColor: template.accent }}>
                {template.logo}
              </div>
              <div>
                <strong>{template.name}</strong>
                <p>{template.author} · ⇩ {template.downloads}</p>
              </div>
            </div>
            <p className="marketplaceDescription">{template.description}</p>
          </Card>
        ))}
      </div>

      <Modal
        destroyOnHidden
        confirmLoading={saving}
        okText={editingProviderId ? "保存" : "安装"}
        open={providerDialogOpen}
        title={editingProviderId ? "编辑模型供应商" : "安装模型供应商"}
        width={620}
        onCancel={() => setProviderDialogOpen(false)}
        onOk={() => providerForm.submit()}
      >
        <Form<ProviderFormValues>
          form={providerForm}
          initialValues={providerDefaults}
          layout="vertical"
          onFinish={(values) => void submitProvider(values)}
        >
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="Ollama" />
          </Form.Item>
          <Form.Item
            label="供应商类型"
            name="providerType"
            rules={[{ required: true, message: "请选择供应商类型" }]}
          >
            <Select
              options={providerTypes.map((type) => ({
                label: providerTypeLabels[type],
                value: type
              }))}
            />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: "请输入 Base URL" }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item label="API Key" name="apiKey">
            <Input.Password placeholder={editingProviderId ? "留空则清除" : "可选"} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        destroyOnHidden
        confirmLoading={saving}
        okText={editingModelId ? "保存" : "添加"}
        open={modelDialogOpen}
        title={editingModelId ? "配置模型" : "添加模型"}
        width={620}
        onCancel={() => setModelDialogOpen(false)}
        onOk={() => modelForm.submit()}
      >
        <Form<ModelFormValues>
          form={modelForm}
          initialValues={modelDefaults}
          layout="vertical"
          onFinish={(values) => void submitModel(values)}
        >
          <Form.Item
            label="供应商"
            name="providerId"
            rules={[{ required: true, message: "请选择供应商" }]}
          >
            <Select options={providerOptions} onChange={handleModelProviderChange} />
          </Form.Item>
          {modelProvider && (
            <div className="modelProviderIdentity">
              <div
                className="providerLogo"
                style={{ backgroundColor: getProviderAccent(modelProvider) }}
              >
                {getProviderLogo(modelProvider)}
              </div>
              <strong>{modelProvider.name}</strong>
            </div>
          )}
          <Form.Item
            label="模型名称"
            name="modelName"
            rules={[{ required: true, message: "请输入模型名称" }]}
          >
            <Input placeholder="qwen2.5" />
          </Form.Item>
          <Form.Item
            label="模型类型"
            name="modelType"
            rules={[{ required: true, message: "请选择模型类型" }]}
          >
            <Select
              options={[
                ...modelTypes.map((type) => ({
                  label: modelTypeLabels[type],
                  value: type
                })),
                { label: "Rerank（暂未支持）", value: "RERANK", disabled: true }
              ]}
            />
          </Form.Item>
          <div className="modelCredentialSection">
            <span>模型凭据</span>
          </div>
          <Form.Item label="凭据名称" name="credentialName">
            <Input placeholder="请输入" />
          </Form.Item>
          <Form.Item
            label="基础 URL"
            name="baseUrl"
            rules={[{ required: true, message: "请输入基础 URL" }]}
          >
            <Input placeholder="Ollama server 的基础 URL，例如 http://192.168.1.100:11434" />
          </Form.Item>
          <Form.Item label="API 密钥（可选）" name="apiKey">
            <Input.Password placeholder="作为 Authorization 标头发送的 Bearer 令牌。如果没有身份验证，请留空。" />
          </Form.Item>
          <Form.Item
            label="模型上下文长度"
            name="contextLength"
            rules={[{ required: true, message: "请输入模型上下文长度" }]}
          >
            <InputNumber min={1} max={1000000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <div className="providerModalGrid hiddenModelAdvanced">
            <Form.Item
              label="超时时间"
              name="timeoutSeconds"
              rules={[{ required: true, message: "请输入超时时间" }]}
            >
              <InputNumber min={1} max={300} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="最大 Token 数" name="maxTokens">
              <InputNumber min={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div className="modalHelpRow">
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
              如何集成 {modelProvider?.name ?? "模型供应商"} ↗
            </a>
          </div>
          <div className="modalSecretNote">您的密钥将加密后存储。</div>
        </Form>
      </Modal>
    </section>
  );
}
