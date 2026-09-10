import { App as AntdApp, Form, Input, Modal } from "antd";
import { useState } from "react";

import { createWorkspace } from "../api";
import type { WorkspaceListItem } from "../types";

type WorkspaceFormValues = {
  name: string;
  description?: string;
};

/** 创建空间表单独立维护临时状态，选择器和空状态共用同一业务入口。 */
export function CreateWorkspaceModal({
  open,
  onCancel,
  onCreated
}: {
  open: boolean;
  onCancel: () => void;
  onCreated: (workspace: WorkspaceListItem) => Promise<void> | void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<WorkspaceFormValues>();
  const [saving, setSaving] = useState(false);

  async function submit(values: WorkspaceFormValues) {
    setSaving(true);
    try {
      const workspace = await createWorkspace(values);
      await onCreated(workspace);
      form.resetFields();
      message.success("项目空间已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建项目空间失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      confirmLoading={saving}
      open={open}
      title="新建项目空间"
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(submit)}
    >
      <Form form={form} layout="vertical">
        <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
          <Input maxLength={80} placeholder="例如：智能客服项目" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea maxLength={500} rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
