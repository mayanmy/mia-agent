import { useEffect, useState } from "react";
import { DownloadOutlined, EyeOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import type { McpPromptItem, McpPromptPreview, McpServerListItem } from "../api";

type PromptValues = { arguments?: Record<string, string>; skillName?: string };
type PromptAction = { prompt: McpPromptItem; mode: "preview" | "import" } | null;

type McpPromptsDrawerProps = {
  server: McpServerListItem | null;
  prompts: McpPromptItem[];
  loading: boolean;
  actionLoading: boolean;
  onClose: () => void;
  onPreview: (
    prompt: McpPromptItem,
    args: Record<string, string>
  ) => Promise<McpPromptPreview | undefined>;
  onImport: (
    prompt: McpPromptItem,
    args: Record<string, string>,
    skillName?: string
  ) => Promise<boolean>;
};

export function McpPromptsDrawer({
  server,
  prompts,
  loading,
  actionLoading,
  onClose,
  onPreview,
  onImport
}: McpPromptsDrawerProps) {
  const [action, setAction] = useState<PromptAction>(null);
  const [preview, setPreview] = useState<McpPromptPreview | null>(null);
  const [form] = Form.useForm<PromptValues>();

  useEffect(() => {
    if (!server) {
      setAction(null);
      setPreview(null);
      form.resetFields();
    }
  }, [form, server]);

  function openAction(prompt: McpPromptItem, mode: "preview" | "import") {
    setAction({ prompt, mode });
    setPreview(null);
    form.resetFields();
    if (mode === "import") form.setFieldValue("skillName", prompt.title || prompt.name);
  }

  async function submit() {
    if (!action) return;
    const values = await form.validateFields();
    const args = values.arguments ?? {};
    if (action.mode === "preview") {
      const result = await onPreview(action.prompt, args);
      if (result) setPreview(result);
      return;
    }
    if (await onImport(action.prompt, args, values.skillName)) {
      setAction(null);
      form.resetFields();
    }
  }

  const columns: TableProps<McpPromptItem>["columns"] = [
    {
      title: "Prompt",
      render: (_, prompt) => (
        <div className="mcpResourceIdentity">
          <strong>{prompt.title || prompt.name}</strong>
          <code>{prompt.name}</code>
          <Typography.Text type="secondary">{prompt.description || "暂无描述"}</Typography.Text>
          <Space size={4} wrap>
            {prompt.arguments.map((argument) => (
              <Tag key={argument.name} color={argument.required ? "blue" : undefined}>
                {argument.name}
                {argument.required ? " *" : ""}
              </Tag>
            ))}
          </Space>
        </div>
      )
    },
    {
      title: "操作",
      width: 112,
      render: (_, prompt) => (
        <Space size={0}>
          <Button
            icon={<EyeOutlined />}
            title="填写参数并预览"
            type="text"
            onClick={() => openAction(prompt, "preview")}
          />
          <Button
            icon={<DownloadOutlined />}
            title="导入为 Skill 草稿"
            type="text"
            onClick={() => openAction(prompt, "import")}
          />
        </Space>
      )
    }
  ];

  return (
    <>
      <Drawer
        destroyOnHidden
        open={Boolean(server)}
        title={server ? `${server.name} · Prompt 目录` : "Prompt 目录"}
        width={760}
        onClose={onClose}
      >
        <Alert
          className="mcpToolNotice"
          message="导入会创建停用的 Skill 草稿。远端 Prompt 后续变化不会覆盖已经导入的内容。"
          showIcon
          type="info"
        />
        <Table<McpPromptItem>
          columns={columns}
          dataSource={prompts}
          loading={loading}
          locale={{
            emptyText: (
              <Empty description="Server 未提供 Prompt" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )
          }}
          pagination={false}
          rowKey="name"
        />
      </Drawer>

      <Modal
        confirmLoading={actionLoading}
        open={Boolean(action)}
        title={action?.mode === "import" ? "导入为 Skill 草稿" : "Prompt 预览"}
        okText={action?.mode === "import" ? "导入草稿" : "生成预览"}
        cancelText="取消"
        width={760}
        onCancel={() => setAction(null)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          {action?.prompt.arguments.map((argument) => (
            <Form.Item
              key={argument.name}
              label={argument.name}
              name={["arguments", argument.name]}
              rules={
                argument.required
                  ? [{ required: true, message: `请输入 ${argument.name}` }]
                  : undefined
              }
              tooltip={argument.description}
            >
              <Input maxLength={2_000} />
            </Form.Item>
          ))}
          {action?.mode === "import" ? (
            <Form.Item
              label="Skill 名称"
              name="skillName"
              rules={[{ required: true, message: "请输入 Skill 名称" }]}
            >
              <Input maxLength={80} />
            </Form.Item>
          ) : null}
        </Form>
        {preview ? (
          <>
            <Space className="mcpResourcePreviewMeta" size={8} wrap>
              <Tag>{preview.messageCount} 条消息</Tag>
              <Tag>{preview.text.length.toLocaleString()} 字符</Tag>
            </Space>
            <pre className="mcpResourcePreview">{preview.text}</pre>
          </>
        ) : null}
      </Modal>
    </>
  );
}
