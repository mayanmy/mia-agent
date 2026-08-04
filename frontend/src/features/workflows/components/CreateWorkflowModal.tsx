import { Form, Input, Modal } from "antd";

/** 新建 Workflow 表单值。 */
export type WorkflowCreateValues = {
  /** Workflow 名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
};

/** 新建 Workflow 弹窗参数。 */
type CreateWorkflowModalProps = {
  /** 弹窗是否打开。 */
  open: boolean;
  /** 是否正在提交创建请求。 */
  saving: boolean;
  /** 取消创建回调。 */
  onCancel: () => void;
  /** 表单校验通过后的异步提交回调。 */
  onSubmit: (values: WorkflowCreateValues) => Promise<void>;
};

/** 创建弹窗只管理临时表单状态，创建和列表刷新仍由页面编排。 */
export function CreateWorkflowModal({
  open,
  saving,
  onCancel,
  onSubmit
}: CreateWorkflowModalProps) {
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
