import { Form, Input, Modal } from "antd";
import { useEffect } from "react";

import type { WorkflowListItem } from "../types";

/** 编辑 Workflow 信息的表单值。 */
export type WorkflowMetadataValues = {
  /** Workflow 展示名称。 */
  name: string;
  /** Workflow 用途说明。 */
  description: string;
};

/** Workflow 信息编辑弹窗参数。 */
type EditWorkflowModalProps = {
  /** 当前编辑对象；null 表示关闭弹窗。 */
  workflow: WorkflowListItem | null;
  /** 是否正在提交更新请求。 */
  saving: boolean;
  /** 取消编辑回调。 */
  onCancel: () => void;
  /** 表单校验通过后的异步提交回调。 */
  onSubmit: (values: WorkflowMetadataValues) => Promise<void>;
};

/** 弹窗只管理临时表单，服务端更新和列表同步仍由路由页面编排。 */
export function EditWorkflowModal({
  workflow,
  saving,
  onCancel,
  onSubmit
}: EditWorkflowModalProps) {
  const [form] = Form.useForm<WorkflowMetadataValues>();

  useEffect(() => {
    if (!workflow) return;
    form.setFieldsValue({ name: workflow.name, description: workflow.description });
  }, [form, workflow]);

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText="保存"
      open={Boolean(workflow)}
      title="编辑 Workflow 信息"
      afterClose={() => form.resetFields()}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<WorkflowMetadataValues>
        form={form}
        layout="vertical"
        onFinish={(values) => void onSubmit(values)}
      >
        <Form.Item
          label="名称"
          name="name"
          rules={[
            { required: true, message: "请输入名称" },
            { max: 100, message: "名称不能超过 100 个字符" }
          ]}
        >
          <Input maxLength={100} showCount />
        </Form.Item>
        <Form.Item
          label="描述"
          name="description"
          rules={[{ max: 2000, message: "描述不能超过 2000 个字符" }]}
        >
          <Input.TextArea maxLength={2000} rows={4} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
