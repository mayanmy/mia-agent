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
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import type { KnowledgeBaseListItem } from "../../knowledge/api";
import type {
  McpResourceCatalog,
  McpResourceItem,
  McpResourcePreview,
  McpResourceTemplateItem,
  McpServerListItem
} from "../api";

type ImportValues = { knowledgeBaseId: string; filename?: string };

type McpResourcesDrawerProps = {
  server: McpServerListItem | null;
  catalog: McpResourceCatalog;
  knowledgeBases: KnowledgeBaseListItem[];
  loading: boolean;
  previewLoading: boolean;
  importLoading: boolean;
  onClose: () => void;
  onPreview: (resource: McpResourceItem) => Promise<McpResourcePreview | undefined>;
  onImport: (resource: McpResourceItem, values: ImportValues) => Promise<boolean>;
};

export function McpResourcesDrawer({
  server,
  catalog,
  knowledgeBases,
  loading,
  previewLoading,
  importLoading,
  onClose,
  onPreview,
  onImport
}: McpResourcesDrawerProps) {
  const [preview, setPreview] = useState<McpResourcePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<McpResourceItem | null>(null);
  const [form] = Form.useForm<ImportValues>();

  useEffect(() => {
    if (!server) {
      setPreview(null);
      setPreviewOpen(false);
      setImportTarget(null);
      form.resetFields();
    }
  }, [form, server]);

  async function openPreview(resource: McpResourceItem) {
    setPreviewOpen(true);
    setPreview(null);
    const result = await onPreview(resource);
    if (result) setPreview(result);
  }

  async function submitImport() {
    if (!importTarget) return;
    const values = await form.validateFields();
    if (await onImport(importTarget, values)) {
      setImportTarget(null);
      form.resetFields();
    }
  }

  const resourceColumns: TableProps<McpResourceItem>["columns"] = [
    {
      title: "资源",
      render: (_, resource) => (
        <div className="mcpResourceIdentity">
          <strong>{resource.title || resource.name}</strong>
          <code>{resource.uri}</code>
          <Typography.Text type="secondary">{resource.description || "暂无描述"}</Typography.Text>
        </div>
      )
    },
    {
      title: "类型",
      dataIndex: "mimeType",
      width: 150,
      render: (value?: string) => <Tag>{value || "未知"}</Tag>
    },
    {
      title: "操作",
      width: 112,
      render: (_, resource) => (
        <Space size={0}>
          <Button
            aria-label={`预览 ${resource.name}`}
            icon={<EyeOutlined />}
            title="预览"
            type="text"
            onClick={() => void openPreview(resource)}
          />
          <Button
            aria-label={`导入 ${resource.name}`}
            icon={<DownloadOutlined />}
            title="导入知识库"
            type="text"
            onClick={() => {
              setImportTarget(resource);
              form.setFieldsValue({ filename: suggestedFilename(resource) });
            }}
          />
        </Space>
      )
    }
  ];

  const templateColumns: TableProps<McpResourceTemplateItem>["columns"] = [
    {
      title: "模板",
      render: (_, template) => (
        <div className="mcpResourceIdentity">
          <strong>{template.title || template.name}</strong>
          <code>{template.uriTemplate}</code>
          <Typography.Text type="secondary">{template.description || "暂无描述"}</Typography.Text>
        </div>
      )
    },
    {
      title: "类型",
      dataIndex: "mimeType",
      width: 150,
      render: (value?: string) => <Tag>{value || "未知"}</Tag>
    }
  ];

  return (
    <>
      <Drawer
        destroyOnHidden
        open={Boolean(server)}
        title={server ? `${server.name} · 资源目录` : "资源目录"}
        width={800}
        onClose={onClose}
      >
        <Alert
          className="mcpToolNotice"
          message="资源目录为远端实时只读视图。导入只支持文本资源，且必须明确选择目标知识库。"
          showIcon
          type="info"
        />
        <Tabs
          items={[
            {
              key: "resources",
              label: `资源 (${catalog.resources.length})`,
              children: (
                <Table<McpResourceItem>
                  columns={resourceColumns}
                  dataSource={catalog.resources}
                  loading={loading}
                  locale={{
                    emptyText: (
                      <Empty description="Server 未提供资源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )
                  }}
                  pagination={false}
                  rowKey="uri"
                />
              )
            },
            {
              key: "templates",
              label: `URI 模板 (${catalog.templates.length})`,
              children: (
                <>
                  <Alert
                    className="mcpResourceTemplateNotice"
                    message="URI 模板需要先由客户端填充参数形成具体 URI，当前仅展示协议定义。"
                    type="warning"
                  />
                  <Table<McpResourceTemplateItem>
                    columns={templateColumns}
                    dataSource={catalog.templates}
                    loading={loading}
                    locale={{
                      emptyText: (
                        <Empty
                          description="Server 未提供 URI 模板"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      )
                    }}
                    pagination={false}
                    rowKey="uriTemplate"
                  />
                </>
              )
            }
          ]}
        />
      </Drawer>

      <Modal
        footer={null}
        loading={previewLoading}
        open={previewOpen}
        title="Resource 预览"
        width={760}
        onCancel={() => setPreviewOpen(false)}
      >
        {preview ? (
          <>
            <Space className="mcpResourcePreviewMeta" size={8} wrap>
              <Tag>{preview.mimeType}</Tag>
              <Tag>{preview.originalChars.toLocaleString()} 字符</Tag>
              {preview.truncated ? <Tag color="orange">预览已截断</Tag> : null}
            </Space>
            <pre className="mcpResourcePreview">{preview.text}</pre>
          </>
        ) : null}
      </Modal>

      <Modal
        confirmLoading={importLoading}
        open={Boolean(importTarget)}
        title="导入知识库"
        okText="导入"
        cancelText="取消"
        onCancel={() => setImportTarget(null)}
        onOk={() => void submitImport()}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Resource URI">
            <Input readOnly value={importTarget?.uri} />
          </Form.Item>
          <Form.Item
            label="目标知识库"
            name="knowledgeBaseId"
            rules={[{ required: true, message: "请选择目标知识库" }]}
          >
            <Select
              options={knowledgeBases
                .filter((item) => item.enabled)
                .map((item) => ({ label: item.name, value: item.id }))}
              placeholder="选择知识库"
            />
          </Form.Item>
          <Form.Item label="导入文件名" name="filename">
            <Input maxLength={240} placeholder="例如 weather-guide.md" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function suggestedFilename(resource: McpResourceItem): string {
  const base = resource.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "mcp-resource";
  if (/\.(txt|md|markdown|csv|json)$/i.test(base)) return base;
  const extension = resource.mimeType?.includes("json")
    ? ".json"
    : resource.mimeType?.includes("markdown")
      ? ".md"
      : resource.mimeType?.includes("csv")
        ? ".csv"
        : ".txt";
  return `${base}${extension}`;
}
