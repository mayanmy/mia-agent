import { Form, Modal, Select } from "antd";
import { FormInstance } from "antd/lib/form";
import { DefaultModelFormValues } from "../types";

type DefaultModelSettingsModalProps = {
  form: FormInstance<DefaultModelFormValues>;
  saving: boolean;
  open: boolean;
  chatModelOptions: { label: string; options: { label: string; value: string }[] }[];
  embeddingModelOptions: { label: string; options: { label: string; value: string }[] }[];
  onCancel: () => void;
  onSubmit: (values: DefaultModelFormValues) => void;
};

export function DefaultModelSettingsModal({
  form,
  saving,
  open,
  chatModelOptions,
  embeddingModelOptions,
  onCancel,
  onSubmit
}: DefaultModelSettingsModalProps) {
  return (
    <Modal
      destroyOnHidden
      forceRender
      confirmLoading={saving}
      okText="保存"
      open={open}
      title="默认模型设置"
      width={620}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<DefaultModelFormValues>
        form={form}
        layout="vertical"
        onFinish={(values) => void onSubmit(values)}
      >
        <Form.Item label="默认 Chat 模型" name="chatModelConfigId">
          <Select allowClear options={chatModelOptions} placeholder="请选择默认 Chat 模型" />
        </Form.Item>
        <Form.Item label="默认 Embedding 模型" name="embeddingModelConfigId">
          <Select
            allowClear
            options={embeddingModelOptions}
            placeholder="请选择默认 Embedding 模型"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
