import { useEffect } from "react";
import { Form, Input, Modal } from "antd";

import type { WorkspaceListItem } from "../types";

export type WorkspaceSettingsValues = {
  name: string;
  description?: string;
};

type WorkspaceSettingsModalProps = {
  open: boolean;
  saving: boolean;
  workspace: WorkspaceListItem;
  onCancel: () => void;
  onSubmit: (values: WorkspaceSettingsValues) => void;
};

/** 编辑当前项目空间资料；持久化与空间列表刷新由路由页统一编排。 */
export function WorkspaceSettingsModal({
  open,
  saving,
  workspace,
  onCancel,
  onSubmit
}: WorkspaceSettingsModalProps) {
  const [form] = Form.useForm<WorkspaceSettingsValues>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: workspace.name,
        description: workspace.description || undefined
      });
    }
  }, [form, open, workspace.description, workspace.name]);

  return (
    <Modal
      confirmLoading={saving}
      open={open}
      title="编辑项目空间"
      okText="保存"
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit)}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="项目空间名称"
          name="name"
          rules={[
            { required: true, message: "请输入项目空间名称" },
            { max: 80, message: "项目空间名称不能超过 80 个字符" }
          ]}
        >
          <Input maxLength={80} />
        </Form.Item>
        <Form.Item
          label="项目空间描述"
          name="description"
          rules={[{ max: 500, message: "项目空间描述不能超过 500 个字符" }]}
        >
          <Input.TextArea maxLength={500} rows={4} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
