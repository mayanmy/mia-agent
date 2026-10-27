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
  // 认证类型决定动态字段与校验规则；私网开关同步改变 Endpoint 的安全提示。
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
                { label: "API Key Header", value: "api_key_header" },
                { label: "Client Credentials", value: "client_credentials" },
                { label: "OAuth Authorization Code + PKCE", value: "oauth" }
              ]}
              onChange={(value) => {
                // 两种 OAuth 流程的服务端默认认证方式不同，切换时重置为兼容默认值。
                if (value === "oauth") form.setFieldValue("clientAuthMethod", "none");
                if (value === "client_credentials") form.setFieldValue("clientAuthMethod", "body");
              }}
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
        {authType === "client_credentials" ? (
          <>
            <Form.Item
              label="Token URL"
              name="tokenUrl"
              rules={[{ required: true, type: "url", message: "请输入合法 Token URL" }]}
            >
              <Input placeholder="https://auth.example.com/oauth/token" />
            </Form.Item>
            <div className="mcpFormGrid">
              <Form.Item
                label="Client ID"
                name="clientId"
                rules={
                  editing && secretConfigured
                    ? []
                    : [{ required: true, message: "请输入 Client ID" }]
                }
              >
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                extra={
                  editing && secretConfigured
                    ? "Client ID 与 Secret 同时留空将保留旧凭据。"
                    : undefined
                }
                label="Client Secret"
                name="clientSecret"
                rules={
                  editing && secretConfigured
                    ? []
                    : [{ required: true, message: "请输入 Client Secret" }]
                }
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </div>
            <div className="mcpFormGrid">
              <Form.Item label="客户端认证方式" name="clientAuthMethod">
                <Select
                  options={[
                    { label: "请求 Body", value: "body" },
                    { label: "HTTP Basic", value: "basic" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="Scope" name="scope">
                <Input placeholder="mcp.read mcp.execute" />
              </Form.Item>
              <Form.Item label="Audience" name="audience">
                <Input placeholder="https://mcp.example.com" />
              </Form.Item>
            </div>
            <div className="mcpFormGrid">
              <Form.Item label="缺省有效期 (秒)" name="defaultTtlSeconds">
                <InputNumber min={30} max={86400} />
              </Form.Item>
              <Form.Item label="提前刷新 (秒)" name="refreshBeforeSeconds">
                <InputNumber min={0} max={86399} />
              </Form.Item>
            </div>
          </>
        ) : authType === "oauth" ? (
          <>
            <div className="mcpFormGrid">
              <Form.Item
                extra="留空时使用服务端支持的动态 Client Registration。"
                label="预注册 Client ID"
                name="clientId"
              >
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                extra={editing && secretConfigured ? "留空将保留已配置的 Client 凭据。" : undefined}
                label="Client Secret"
                name="clientSecret"
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </div>
            <div className="mcpFormGrid">
              <Form.Item label="Token Endpoint 认证" name="clientAuthMethod">
                <Select
                  options={[
                    { label: "公共客户端 (none)", value: "none" },
                    { label: "Client Secret Basic", value: "client_secret_basic" },
                    { label: "Client Secret Post", value: "client_secret_post" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="Scope" name="scope">
                <Input placeholder="mcp.read mcp.execute" />
              </Form.Item>
            </div>
          </>
        ) : authType !== "none" ? (
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
                { label: "人工确认", value: "confirm" },
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
