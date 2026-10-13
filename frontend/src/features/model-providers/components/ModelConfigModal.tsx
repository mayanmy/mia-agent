import { AutoComplete, Button, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import { useEffect } from "react";
import type { DefaultOptionType } from "antd/es/select";

import type { ProviderListItem, ProviderRemoteModel } from "../api";
import type { ModelFormValues } from "../types";
import {
  getProviderAccent,
  getProviderLogo,
  inferEmbeddingDimension,
  modelDefaults,
  modelTypeLabels,
  modelTypes
} from "../utils";

type ModelConfigModalProps = {
  initialValues: ModelFormValues;
  open: boolean;
  saving: boolean;
  editingModelId: string | null;
  providers: ProviderListItem[];
  providerOptions: { label: string; value: string }[];
  remoteModels: ProviderRemoteModel[];
  remoteModelOptions: { label: string; value: string }[];
  syncingModels: boolean;
  onCancel: () => void;
  onSubmit: (values: ModelFormValues) => void;
  onModelProviderChange: (providerId: string) => void;
  onSyncProviderModels: (providerId?: string) => void;
};

export function ModelConfigModal(props: ModelConfigModalProps) {
  if (!props.open) {
    return null;
  }

  return <OpenModelConfigModal {...props} />;
}

function OpenModelConfigModal({
  initialValues,
  saving,
  editingModelId,
  providers,
  providerOptions,
  remoteModels,
  remoteModelOptions,
  syncingModels,
  onCancel,
  onSubmit,
  onModelProviderChange,
  onSyncProviderModels
}: ModelConfigModalProps) {
  const [form] = Form.useForm<ModelFormValues>();
  const selectedProviderId = Form.useWatch("providerId", form);
  const selectedModelType = Form.useWatch("modelType", form);
  const thinkingSupported = Form.useWatch("thinkingSupported", form);
  const modelProvider = providers.find((provider) => provider.id === selectedProviderId);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [form, initialValues]);

  function handleProviderChange(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    form.setFieldsValue({
      baseUrl: provider?.baseUrl ?? "",
      credentialName: provider ? `${provider.name} 默认凭据` : ""
    });
    onModelProviderChange(providerId);
  }

  function handleRemoteModelChange(modelName: string) {
    const remoteModel = remoteModels.find((item) => item.modelName === modelName);

    if (!remoteModel) {
      form.setFieldsValue({
        modelName,
        ...(form.getFieldValue("modelType") === "EMBEDDING"
          ? { embeddingDimension: inferEmbeddingDimension(modelName) }
          : {})
      });
      return;
    }

    form.setFieldsValue({
      modelName: remoteModel.modelName,
      modelType: remoteModel.suggestedType,
      embeddingDimension:
        remoteModel.suggestedType === "EMBEDDING"
          ? inferEmbeddingDimension(remoteModel.modelName)
          : null,
      contextLength: remoteModel.contextLength ?? form.getFieldValue("contextLength") ?? 4096
    });
  }

  function handleModelTypeChange(modelType: ModelFormValues["modelType"]) {
    if (modelType !== "EMBEDDING") {
      form.setFieldsValue({ embeddingDimension: null });
      return;
    }

    form.setFieldsValue({
      embeddingDimension:
        form.getFieldValue("embeddingDimension") ??
        inferEmbeddingDimension(form.getFieldValue("modelName") ?? "")
    });
  }

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={editingModelId ? "保存" : "添加"}
      open
      title={editingModelId ? "配置模型" : "添加模型"}
      width={620}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<ModelFormValues>
        form={form}
        initialValues={modelDefaults}
        layout="vertical"
        onFinish={(values) => onSubmit(values)}
      >
        <Form.Item
          label="供应商"
          name="providerId"
          rules={[{ required: true, message: "请选择供应商" }]}
        >
          <Select options={providerOptions} onChange={handleProviderChange} />
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
          label={
            <span className="formLabelWithAction">
              <span>模型名称</span>
              <Button
                loading={syncingModels}
                size="small"
                type="default"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSyncProviderModels(form.getFieldValue("providerId"));
                }}
              >
                同步模型列表
              </Button>
            </span>
          }
          name="modelName"
          rules={[{ required: true, message: "请输入模型名称" }]}
        >
          <AutoComplete
            filterOption={filterRemoteModelOption}
            options={remoteModelOptions}
            placeholder="qwen2.5"
            onChange={handleRemoteModelChange}
          />
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
            onChange={handleModelTypeChange}
          />
        </Form.Item>
        {selectedModelType === "EMBEDDING" && (
          <Form.Item
            extra="向量维度会被新建知识库保存为固定快照；同一个知识库内所有文档必须使用相同维度。"
            label="向量维度"
            name="embeddingDimension"
            rules={[{ required: true, message: "请输入向量维度" }]}
          >
            <InputNumber min={1} max={100000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        )}
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
        {selectedModelType === "CHAT" && (
          <>
            <Form.Item
              extra="启用后，Runtime 才会将图片输入路由到此模型；该声明默认标记为未验证。"
              label="支持图片理解"
              name="visionInput"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              extra="开启后，绑定该模型的 Agent 才能单独选择开启或关闭思考。"
              label="支持思考模式"
              name="thinkingSupported"
              valuePropName="checked"
            >
              <Switch
                onChange={(checked) => {
                  if (!checked) form.setFieldValue("thinkingMode", "AUTO");
                }}
              />
            </Form.Item>
            <Form.Item
              extra="Agent 选择“跟随模型默认”时使用此设置。"
              label="默认思考模式"
              name="thinkingMode"
            >
              <Select
                disabled={!thinkingSupported}
                options={[
                  { label: "自动（供应商默认）", value: "AUTO" },
                  { label: "默认开启", value: "ENABLED" },
                  { label: "默认关闭", value: "DISABLED" }
                ]}
              />
            </Form.Item>
          </>
        )}
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
  );
}

function filterRemoteModelOption(inputValue: string, option?: DefaultOptionType): boolean {
  const keyword = normalizeSearchText(inputValue);

  if (!keyword) {
    return true;
  }

  const optionText = normalizeSearchText(
    [option?.value, option?.label].filter((item) => typeof item === "string").join(" ")
  );

  // 支持普通包含匹配，也支持 qwenembedding 这类少打分隔符的顺序模糊匹配。
  return optionText.includes(keyword) || isSubsequence(keyword, optionText);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[\s._:/-]+/gu, "");
}

function isSubsequence(keyword: string, target: string): boolean {
  let cursor = 0;

  for (const character of target) {
    if (character === keyword[cursor]) {
      cursor += 1;
    }

    if (cursor === keyword.length) {
      return true;
    }
  }

  return false;
}
