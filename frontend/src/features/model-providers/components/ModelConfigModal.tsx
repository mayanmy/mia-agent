import {
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  type FormInstance
} from "antd";

import type { ProviderListItem } from "../api";
import type { ModelFormValues } from "../types";
import {
  getProviderAccent,
  getProviderLogo,
  modelDefaults,
  modelTypeLabels,
  modelTypes
} from "../utils";

type ModelConfigModalProps = {
  form: FormInstance<ModelFormValues>;
  open: boolean;
  saving: boolean;
  editingModelId: string | null;
  providerOptions: { label: string; value: string }[];
  modelProvider?: ProviderListItem;
  remoteModelOptions: { label: string; value: string }[];
  syncingModels: boolean;
  onCancel: () => void;
  onSubmit: (values: ModelFormValues) => void;
  onModelProviderChange: (providerId: string) => void;
  onSyncProviderModels: () => void;
  onRemoteModelChange: (modelName: string) => void;
};

export function ModelConfigModal({
  form,
  open,
  saving,
  editingModelId,
  providerOptions,
  modelProvider,
  remoteModelOptions,
  syncingModels,
  onCancel,
  onSubmit,
  onModelProviderChange,
  onSyncProviderModels,
  onRemoteModelChange
}: ModelConfigModalProps) {
  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={editingModelId ? "保存" : "添加"}
      open={open}
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
          <Select options={providerOptions} onChange={onModelProviderChange} />
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
                  onSyncProviderModels();
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
            options={remoteModelOptions}
            placeholder="qwen2.5"
            onChange={onRemoteModelChange}
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
  );
}
