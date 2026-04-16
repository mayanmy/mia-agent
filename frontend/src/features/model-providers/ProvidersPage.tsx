import { FormEvent, useEffect, useMemo, useState } from "react";

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
  CHAT: "对话模型",
  EMBEDDING: "向量模型"
};

type LoadState = "idle" | "loading" | "saving";

type ProviderFormState = {
  id: string | null;
  name: string;
  providerType: ModelProviderType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

type ModelConfigFormState = {
  id: string | null;
  providerId: string;
  modelName: string;
  modelType: ModelConfigType;
  enabled: boolean;
  timeoutSeconds: string;
  maxTokens: string;
};

const emptyProviderForm: ProviderFormState = {
  id: null,
  name: "",
  providerType: "OPENAI_COMPATIBLE",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  enabled: true
};

const emptyModelConfigForm: ModelConfigFormState = {
  id: null,
  providerId: "",
  modelName: "",
  modelType: "CHAT",
  enabled: true,
  timeoutSeconds: "120",
  maxTokens: ""
};

function toProviderPayload(form: ProviderFormState): ProviderPayload {
  return {
    name: form.name.trim(),
    providerType: form.providerType,
    baseUrl: form.baseUrl.trim(),
    apiKey: form.apiKey,
    enabled: form.enabled
  };
}

function toModelConfigPayload(form: ModelConfigFormState): ModelConfigPayload {
  return {
    providerId: form.providerId,
    modelName: form.modelName.trim(),
    modelType: form.modelType,
    enabled: form.enabled,
    timeoutSeconds: Number(form.timeoutSeconds || 120),
    maxTokens: form.maxTokens.trim() ? Number(form.maxTokens) : null
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [modelConfigs, setModelConfigs] = useState<ModelConfigListItem[]>([]);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm);
  const [modelConfigForm, setModelConfigForm] =
    useState<ModelConfigFormState>(emptyModelConfigForm);
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const providerOptions = useMemo(
    () => providers.map((provider) => ({ label: provider.name, value: provider.id })),
    [providers]
  );

  async function refresh() {
    setState("loading");
    setError("");

    try {
      const [providerPage, modelConfigPage] = await Promise.all([
        listProviders(),
        listModelConfigs()
      ]);
      setProviders(providerPage.list);
      setModelConfigs(modelConfigPage.list);
      setModelConfigForm((current) => ({
        ...current,
        providerId: current.providerId || providerPage.list[0]?.id || ""
      }));
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "加载模型供应商失败");
    } finally {
      setState("idle");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleProviderSubmit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    setError("");
    setMessage("");

    try {
      const payload = toProviderPayload(providerForm);
      if (providerForm.id) {
        await updateProvider(providerForm.id, payload);
        setMessage("供应商已更新");
      } else {
        await createProvider(payload);
        setMessage("供应商已创建");
      }
      setProviderForm(emptyProviderForm);
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存供应商失败");
    } finally {
      setState("idle");
    }
  }

  async function handleModelConfigSubmit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    setError("");
    setMessage("");

    try {
      const payload = toModelConfigPayload(modelConfigForm);
      if (modelConfigForm.id) {
        await updateModelConfig(modelConfigForm.id, payload);
        setMessage("模型配置已更新");
      } else {
        await createModelConfig(payload);
        setMessage("模型配置已创建");
      }
      setModelConfigForm({ ...emptyModelConfigForm, providerId: payload.providerId });
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存模型配置失败");
    } finally {
      setState("idle");
    }
  }

  async function handleDeleteProvider(id: string) {
    setState("saving");
    setError("");
    setMessage("");

    try {
      await deleteProvider(id);
      setMessage("供应商已删除");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除供应商失败");
    } finally {
      setState("idle");
    }
  }

  async function handleDeleteModelConfig(id: string) {
    setState("saving");
    setError("");
    setMessage("");

    try {
      await deleteModelConfig(id);
      setMessage("模型配置已删除");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除模型配置失败");
    } finally {
      setState("idle");
    }
  }

  async function handleTestProvider(id: string) {
    setState("saving");
    setError("");
    setMessage("");

    try {
      const result = await testProviderConnection(id);
      setMessage(
        result.ok
          ? `连接正常，耗时 ${result.latencyMs}ms`
          : `连接失败： ${result.statusText}`
      );
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "测试供应商失败");
    } finally {
      setState("idle");
    }
  }

  return (
    <section className="workspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">设置</p>
          <h1>模型供应商</h1>
        </div>
        <button className="secondaryButton" disabled={state === "loading"} onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {message && <div className="notice successNotice">{message}</div>}
      {error && <div className="notice errorNotice">{error}</div>}

      <div className="twoColumnGrid">
        <form className="panel formPanel" onSubmit={(event) => void handleProviderSubmit(event)}>
          <div className="panelHeader">
            <h2>{providerForm.id ? "编辑供应商" : "新增供应商"}</h2>
          </div>
          <div className="formBody">
            <label>
              <span>名称</span>
              <input
                value={providerForm.name}
                onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })}
                placeholder="本地 Ollama"
              />
            </label>
            <label>
              <span>类型</span>
              <select
                value={providerForm.providerType}
                onChange={(event) =>
                  setProviderForm({
                    ...providerForm,
                    providerType: event.target.value as ModelProviderType
                  })
                }
              >
                {providerTypes.map((type) => (
                  <option key={type} value={type}>
                    {providerTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>基础 URL</span>
              <input
                value={providerForm.baseUrl}
                onChange={(event) =>
                  setProviderForm({ ...providerForm, baseUrl: event.target.value })
                }
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              <span>API Key</span>
              <input
                value={providerForm.apiKey}
                onChange={(event) =>
                  setProviderForm({ ...providerForm, apiKey: event.target.value })
                }
                placeholder={providerForm.id ? "留空则清除" : "可选"}
                type="password"
              />
            </label>
            <label className="checkboxRow">
              <input
                checked={providerForm.enabled}
                onChange={(event) =>
                  setProviderForm({ ...providerForm, enabled: event.target.checked })
                }
                type="checkbox"
              />
              <span>启用</span>
            </label>
            <div className="buttonRow">
              <button className="primaryButton" disabled={state === "saving"} type="submit">
                {providerForm.id ? "保存供应商" : "创建供应商"}
              </button>
              {providerForm.id && (
                <button
                  className="secondaryButton"
                  onClick={() => setProviderForm(emptyProviderForm)}
                  type="button"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </form>

        <form className="panel formPanel" onSubmit={(event) => void handleModelConfigSubmit(event)}>
          <div className="panelHeader">
            <h2>{modelConfigForm.id ? "编辑模型" : "新增模型"}</h2>
          </div>
          <div className="formBody">
            <label>
              <span>供应商</span>
              <select
                value={modelConfigForm.providerId}
                onChange={(event) =>
                  setModelConfigForm({ ...modelConfigForm, providerId: event.target.value })
                }
              >
                <option value="">请选择供应商</option>
                {providerOptions.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>模型名称</span>
              <input
                value={modelConfigForm.modelName}
                onChange={(event) =>
                  setModelConfigForm({ ...modelConfigForm, modelName: event.target.value })
                }
                placeholder="gpt-4.1-mini"
              />
            </label>
            <label>
              <span>模型类型</span>
              <select
                value={modelConfigForm.modelType}
                onChange={(event) =>
                  setModelConfigForm({
                    ...modelConfigForm,
                    modelType: event.target.value as ModelConfigType
                  })
                }
              >
                {modelTypes.map((type) => (
                  <option key={type} value={type}>
                    {modelTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <div className="formGrid">
              <label>
                <span>超时时间</span>
                <input
                  min="1"
                  max="300"
                  value={modelConfigForm.timeoutSeconds}
                  onChange={(event) =>
                    setModelConfigForm({
                      ...modelConfigForm,
                      timeoutSeconds: event.target.value
                    })
                  }
                  type="number"
                />
              </label>
              <label>
                <span>最大 Token 数</span>
                <input
                  min="1"
                  value={modelConfigForm.maxTokens}
                  onChange={(event) =>
                    setModelConfigForm({ ...modelConfigForm, maxTokens: event.target.value })
                  }
                  placeholder="可选"
                  type="number"
                />
              </label>
            </div>
            <label className="checkboxRow">
              <input
                checked={modelConfigForm.enabled}
                onChange={(event) =>
                  setModelConfigForm({ ...modelConfigForm, enabled: event.target.checked })
                }
                type="checkbox"
              />
              <span>启用</span>
            </label>
            <div className="buttonRow">
              <button className="primaryButton" disabled={state === "saving"} type="submit">
                {modelConfigForm.id ? "保存模型" : "创建模型"}
              </button>
              {modelConfigForm.id && (
                <button
                  className="secondaryButton"
                  onClick={() =>
                    setModelConfigForm({
                      ...emptyModelConfigForm,
                      providerId: modelConfigForm.providerId
                    })
                  }
                  type="button"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      <div className="panel tablePanel">
        <div className="panelHeader">
          <h2>供应商</h2>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>类型</th>
                <th>基础 URL</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}</td>
                  <td>{providerTypeLabels[provider.providerType]}</td>
                  <td>{provider.baseUrl}</td>
                  <td>{provider.enabled ? "启用" : "停用"}</td>
                  <td>{formatDate(provider.updatedAt)}</td>
                  <td>
                    <div className="tableActions">
                      <button
                        className="textButton"
                        onClick={() =>
                          setProviderForm({
                            id: provider.id,
                            name: provider.name,
                            providerType: provider.providerType,
                            baseUrl: provider.baseUrl,
                            apiKey: "",
                            enabled: provider.enabled
                          })
                        }
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="textButton"
                        onClick={() => void handleTestProvider(provider.id)}
                        type="button"
                      >
                        测试
                      </button>
                      <button
                        className="dangerButton"
                        onClick={() => void handleDeleteProvider(provider.id)}
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6}>暂无供应商。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel tablePanel">
        <div className="panelHeader">
          <h2>模型配置</h2>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>类型</th>
                <th>供应商</th>
                <th>超时时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {modelConfigs.map((config) => {
                const provider = providers.find((item) => item.id === config.providerId);
                return (
                  <tr key={config.id}>
                    <td>{config.modelName}</td>
                    <td>{modelTypeLabels[config.modelType]}</td>
                    <td>{provider?.name || config.providerId}</td>
                    <td>{config.timeoutSeconds}s</td>
                    <td>{config.enabled ? "启用" : "停用"}</td>
                    <td>
                      <div className="tableActions">
                        <button
                          className="textButton"
                          onClick={() =>
                            setModelConfigForm({
                              id: config.id,
                              providerId: config.providerId,
                              modelName: config.modelName,
                              modelType: config.modelType,
                              enabled: config.enabled,
                              timeoutSeconds: String(config.timeoutSeconds),
                              maxTokens: config.maxTokens ? String(config.maxTokens) : ""
                            })
                          }
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="dangerButton"
                          onClick={() => void handleDeleteModelConfig(config.id)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {modelConfigs.length === 0 && (
                <tr>
                  <td colSpan={6}>暂无模型配置。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
