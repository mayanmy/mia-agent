import { Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import type { FormInstance } from "antd";

import type { McpServerFormValues } from "../api";

type McpServerFormModalProps = {
  open: boolean;
  editing: boolean;
  saving: boolean;
  secretConfigured: boolean;
  form: FormInstance<McpServerFormValues>;
  onCancel: () => void;
  onSubmit: (values: McpServerFormValues) => void;
};

export function McpServerFormModal({
  open,
  editing,
  saving,
  secretConfigured,
  form,
  onCancel,
  onSubmit
}: McpServerFormModalProps) {
  const authType = Form.useWatch("authType", form);
  const allowPrivateNetwork = Form.useWatch("allowPrivateNetwork", form);

  return (
    <Modal
      confirmLoading={saving}
      destroyOnHidden
      okText={editing ? "保存" : "创建"}
      open={open}
      title={editing ? "编辑 MCP Server" : "新增 MCP Server"}
      width={860}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit)}
    >
      <Form<McpServerFormValues> form={form} layout="vertical" requiredMark="optional">
        <div className="mcpFormGrid">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={80} placeholder="例如：内部工单 MCP" />
          </Form.Item>
          <Form.Item
            label="Slug"
            name="slug"
            rules={[
              { required: true, message: "请输入 Slug" },
              { pattern: /^[a-z][a-z0-9-]{1,62}$/, message: "使用小写字母、数字和连字符" }
            ]}
          >
            <Input placeholder="internal-tickets" />
          </Form.Item>
        </div>
        <Form.Item label="描述" name="description">
          <Input.TextArea maxLength={500} rows={3} />
        </Form.Item>
        <Form.Item
          extra={
            allowPrivateNetwork
              ? "已允许 HTTP 与私网地址；仅用于可信的内网 MCP Server。"
              : "公网地址必须使用 HTTPS。"
          }
          label="Streamable HTTP Endpoint"
          name="endpoint"
          rules={[{ required: true, type: "url", message: "请输入合法 Endpoint" }]}
        >
          <Input placeholder="https://mcp.example.com/mcp" />
        </Form.Item>
        <div className="mcpFormGrid">
          <Form.Item label="鉴权方式" name="authType">
            <Select
              options={[
                { label: "无鉴权", value: "none" },
                { label: "Bearer Token", value: "bearer" },
                { label: "API Key Header", value: "api_key_header" }
              ]}
            />
          </Form.Item>
          {authType === "api_key_header" ? (
            <Form.Item
              label="Header 名称"
              name="headerName"
              rules={[{ required: true, message: "请输入 Header 名称" }]}
            >
              <Input placeholder="X-API-Key" />
            </Form.Item>
          ) : null}
        </div>
        {authType !== "none" ? (
          <Form.Item
            extra={editing && secretConfigured ? "留空将保留已配置的凭据。" : undefined}
            label={authType === "bearer" ? "Bearer Token" : "API Key"}
            name="secret"
            rules={editing && secretConfigured ? [] : [{ required: true, message: "请输入凭据" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        ) : null}
        <div className="mcpSwitchRow">
          <Form.Item label="启用 Server" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="允许私网访问" name="allowPrivateNetwork" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="默认执行策略" name="approvalMode">
            <Select
              className="mcpPolicySelect"
              options={[
                { label: "自动执行", value: "auto" },
                { label: "禁止执行", value: "disabled" }
              ]}
            />
          </Form.Item>
        </div>
        <div className="mcpLimitsGrid">
          <Form.Item label="连接超时 (ms)" name="connectTimeoutMs">
            <InputNumber min={1000} max={60000} step={1000} />
          </Form.Item>
          <Form.Item label="工具超时 (ms)" name="toolTimeoutMs">
            <InputNumber min={1000} max={300000} step={1000} />
          </Form.Item>
          <Form.Item label="并发数" name="maxConcurrency">
            <InputNumber min={1} max={20} />
          </Form.Item>
          <Form.Item label="响应上限 (bytes)" name="maxResponseBytes">
            <InputNumber min={1024} max={10000000} step={1024} />
          </Form.Item>
          <Form.Item label="模型输出上限 (字符)" name="maxOutputChars">
            <InputNumber min={1000} max={200000} step={1000} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
