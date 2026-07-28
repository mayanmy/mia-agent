import { Form, Input, Modal } from "antd";

export type WorkflowCreateValues = { name: string; description: string };

type Props = {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: WorkflowCreateValues) => Promise<void>;
};

/** 创建弹窗只管理临时表单状态，创建和列表刷新仍由页面编排。 */
export function CreateWorkflowModal({ open, saving, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<WorkflowCreateValues>();

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText="创建"
      open={open}
      title="新建 Workflow"
      afterClose={() => form.resetFields()}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<WorkflowCreateValues>
        form={form}
        initialValues={{ name: "", description: "" }}
        layout="vertical"
        onFinish={(values) => void onSubmit(values)}
      >
        <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea maxLength={2000} rows={4} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
