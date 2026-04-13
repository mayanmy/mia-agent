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
      setError(refreshError instanceof Error ? refreshError.message : "Failed to load providers");
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
        setMessage("Provider updated");
      } else {
        await createProvider(payload);
        setMessage("Provider created");
      }
      setProviderForm(emptyProviderForm);
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save provider");
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
        setMessage("Model config updated");
      } else {
        await createModelConfig(payload);
        setMessage("Model config created");
      }
      setModelConfigForm({ ...emptyModelConfigForm, providerId: payload.providerId });
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save model config");
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
      setMessage("Provider deleted");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete provider");
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
      setMessage("Model config deleted");
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete model config");
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
          ? `Connection ok in ${result.latencyMs}ms`
          : `Connection failed: ${result.statusText}`
      );
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Failed to test provider");
    } finally {
      setState("idle");
    }
  }

  return (
    <section className="workspace">
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Model Providers</h1>
        </div>
        <button className="secondaryButton" disabled={state === "loading"} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {message && <div className="notice successNotice">{message}</div>}
      {error && <div className="notice errorNotice">{error}</div>}

      <div className="twoColumnGrid">
        <form className="panel formPanel" onSubmit={(event) => void handleProviderSubmit(event)}>
          <div className="panelHeader">
            <h2>{providerForm.id ? "Edit Provider" : "New Provider"}</h2>
          </div>
          <div className="formBody">
            <label>
              <span>Name</span>
              <input
                value={providerForm.name}
                onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })}
                placeholder="Local Ollama"
              />
            </label>
            <label>
              <span>Type</span>
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
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Base URL</span>
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
                placeholder={providerForm.id ? "Leave blank to clear" : "Optional"}
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
              <span>Enabled</span>
            </label>
            <div className="buttonRow">
              <button className="primaryButton" disabled={state === "saving"} type="submit">
                {providerForm.id ? "Save Provider" : "Create Provider"}
              </button>
              {providerForm.id && (
                <button
                  className="secondaryButton"
                  onClick={() => setProviderForm(emptyProviderForm)}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </form>

        <form className="panel formPanel" onSubmit={(event) => void handleModelConfigSubmit(event)}>
          <div className="panelHeader">
            <h2>{modelConfigForm.id ? "Edit Model" : "New Model"}</h2>
          </div>
          <div className="formBody">
            <label>
              <span>Provider</span>
              <select
                value={modelConfigForm.providerId}
                onChange={(event) =>
                  setModelConfigForm({ ...modelConfigForm, providerId: event.target.value })
                }
              >
                <option value="">Select provider</option>
                {providerOptions.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Model Name</span>
              <input
                value={modelConfigForm.modelName}
                onChange={(event) =>
                  setModelConfigForm({ ...modelConfigForm, modelName: event.target.value })
                }
                placeholder="gpt-4.1-mini"
              />
            </label>
            <label>
              <span>Model Type</span>
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
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <div className="formGrid">
              <label>
                <span>Timeout</span>
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
                <span>Max Tokens</span>
                <input
                  min="1"
                  value={modelConfigForm.maxTokens}
                  onChange={(event) =>
                    setModelConfigForm({ ...modelConfigForm, maxTokens: event.target.value })
                  }
                  placeholder="Optional"
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
              <span>Enabled</span>
            </label>
            <div className="buttonRow">
              <button className="primaryButton" disabled={state === "saving"} type="submit">
                {modelConfigForm.id ? "Save Model" : "Create Model"}
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
                  Cancel
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      <div className="panel tablePanel">
        <div className="panelHeader">
          <h2>Providers</h2>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Base URL</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>{provider.name}</td>
                  <td>{provider.providerType}</td>
                  <td>{provider.baseUrl}</td>
                  <td>{provider.enabled ? "Enabled" : "Disabled"}</td>
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
                        Edit
                      </button>
                      <button
                        className="textButton"
                        onClick={() => void handleTestProvider(provider.id)}
                        type="button"
                      >
                        Test
                      </button>
                      <button
                        className="dangerButton"
                        onClick={() => void handleDeleteProvider(provider.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr>
                  <td colSpan={6}>No providers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel tablePanel">
        <div className="panelHeader">
          <h2>Model Configs</h2>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Type</th>
                <th>Provider</th>
                <th>Timeout</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {modelConfigs.map((config) => {
                const provider = providers.find((item) => item.id === config.providerId);
                return (
                  <tr key={config.id}>
                    <td>{config.modelName}</td>
                    <td>{config.modelType}</td>
                    <td>{provider?.name || config.providerId}</td>
                    <td>{config.timeoutSeconds}s</td>
                    <td>{config.enabled ? "Enabled" : "Disabled"}</td>
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
                          Edit
                        </button>
                        <button
                          className="dangerButton"
                          onClick={() => void handleDeleteModelConfig(config.id)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {modelConfigs.length === 0 && (
                <tr>
                  <td colSpan={6}>No model configs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

