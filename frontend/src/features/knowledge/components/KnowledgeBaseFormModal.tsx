import { Form, Input, Modal, Select, Switch } from "antd";
import type { FormInstance } from "antd";

import type { KnowledgeBaseFormValues } from "../types";

export function KnowledgeBaseFormModal({
  form,
  open,
  editing,
  saving,
  embeddingModelOptions,
  onCancel,
  onSubmit
}: {
  form: FormInstance<KnowledgeBaseFormValues>;
  open: boolean;
  editing: boolean;
  saving: boolean;
  embeddingModelOptions: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onSubmit: (values: KnowledgeBaseFormValues) => void;
}) {
  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={editing ? "保存" : "创建"}
      open={open}
      title={editing ? "编辑知识库" : "新增知识库"}
      width={640}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<KnowledgeBaseFormValues>
        form={form}
        initialValues={{
          name: "",
          description: "",
          embeddingModelConfigId: "",
          enabled: true
        }}
        layout="vertical"
        onFinish={onSubmit}
      >
        <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
          <Input />
        </Form.Item>
        <Form.Item
          extra={
            editing
              ? "Embedding 模型和向量维度已随知识库锁定，如需更换模型请创建新知识库并重新上传文档。"
              : "Embedding 模型决定该知识库的向量维度，创建后不建议直接修改。"
          }
          label="Embedding 模型"
          name="embeddingModelConfigId"
          rules={[{ required: true, message: "请选择 Embedding 模型" }]}
        >
          <Select
            disabled={editing}
            notFoundContent="暂无可用 Embedding 模型"
            options={embeddingModelOptions}
            placeholder="请选择 Embedding 模型"
          />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
