import { Form, Input, Modal, Select, Switch, type FormInstance } from "antd";

import type { ProviderFormValues } from "../types";
import { providerDefaults, providerTypeLabels, providerTypes } from "../utils";

type ProviderFormModalProps = {
  form: FormInstance<ProviderFormValues>;
  open: boolean;
  saving: boolean;
  editingProviderId: string | null;
  editingProviderApiKeyMasked: string;
  onCancel: () => void;
  onSubmit: (values: ProviderFormValues) => void;
};

export function ProviderFormModal({
  form,
  open,
  saving,
  editingProviderId,
  editingProviderApiKeyMasked,
  onCancel,
  onSubmit
}: ProviderFormModalProps) {
  return (
    <Modal
      destroyOnHidden
      forceRender
      confirmLoading={saving}
      okText={editingProviderId ? "保存" : "安装"}
      open={open}
      title={editingProviderId ? "编辑模型供应商" : "安装模型供应商"}
      width={620}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<ProviderFormValues>
        form={form}
        initialValues={providerDefaults}
        layout="vertical"
        onFinish={(values) => onSubmit(values)}
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
          <Input.Password
            placeholder={
              editingProviderId && editingProviderApiKeyMasked
                ? editingProviderApiKeyMasked
                : "可选"
            }
          />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
