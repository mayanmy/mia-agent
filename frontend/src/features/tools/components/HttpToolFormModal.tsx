import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import type { FormInstance } from "antd";

import type { HttpToolFormValues } from "../api";

export function HttpToolFormModal({
  form,
  open,
  editing,
  saving,
  secretConfigured,
  onCancel,
  onSubmit
}: {
  form: FormInstance<HttpToolFormValues>;
  open: boolean;
  editing: boolean;
  saving: boolean;
  secretConfigured: boolean;
  onCancel: () => void;
  onSubmit: (values: HttpToolFormValues) => void;
}) {
  const method = Form.useWatch("method", form);
  const authType = Form.useWatch("authType", form);

  return (
    <Modal
      destroyOnHidden
      confirmLoading={saving}
      okText={editing ? "保存" : "创建"}
      open={open}
      title={editing ? "编辑 HTTP API 工具" : "新增 HTTP API 工具"}
      width={860}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form<HttpToolFormValues> form={form} layout="vertical" onFinish={onSubmit}>
        <div className="httpToolFormGrid">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="查询订单" />
          </Form.Item>
          <Form.Item
            label="标识"
            name="slug"
            rules={[
              { required: true, message: "请输入标识" },
              { pattern: /^[a-z][a-z0-9_]*$/, message: "使用小写字母、数字和下划线" }
            ]}
          >
            <Input placeholder="query_order" />
          </Form.Item>
          <Form.Item className="httpToolFormFull" label="描述" name="description">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="说明模型何时应调用该工具"
            />
          </Form.Item>
          <Form.Item label="方法" name="method" rules={[{ required: true }]}>
            <Select options={[{ value: "GET" }, { value: "POST" }]} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: "请输入 Base URL" }]}
          >
            <Input placeholder="http://orders-api:9000" />
          </Form.Item>
          <Form.Item label="Path" name="path" rules={[{ required: true, message: "请输入 Path" }]}>
            <Input placeholder="/api/orders/{orderId}" />
          </Form.Item>
        </div>

        <section className="httpToolFormSection">
          <div className="httpToolSectionHeader">
            <strong>业务参数</strong>
          </div>
          <Form.List name="parameters">
            {(fields, { add, remove }) => (
              <div className="httpToolRows">
                {fields.map((field) => (
                  <div className="httpToolParameterRow" key={field.key}>
                    <Form.Item
                      {...field}
                      name={[field.name, "name"]}
                      rules={[{ required: true, message: "参数名" }]}
                    >
                      <Input placeholder="orderId" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "targetName"]}>
                      <Input placeholder="HTTP 字段" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "type"]} rules={[{ required: true }]}>
                      <Select
                        options={["string", "number", "boolean", "object", "array"].map(
                          (value) => ({ value })
                        )}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "location"]}
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={[
                          "path",
                          "query",
                          "header",
                          ...(method === "POST" ? ["body"] : [])
                        ].map((value) => ({ value }))}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "description"]}>
                      <Input placeholder="参数说明" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "required"]} valuePropName="checked">
                      <Checkbox>必填</Checkbox>
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "sensitive"]} valuePropName="checked">
                      <Checkbox>脱敏</Checkbox>
                    </Form.Item>
                    <Button danger type="text" onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    add({ type: "string", location: "query", required: false, sensitive: false })
                  }
                >
                  添加参数
                </Button>
              </div>
            )}
          </Form.List>
        </section>

        <section className="httpToolFormSection">
          <div className="httpToolSectionHeader">
            <strong>固定 Headers</strong>
          </div>
          <Form.List name="fixedHeaders">
            {(fields, { add, remove }) => (
              <div className="httpToolRows">
                {fields.map((field) => (
                  <div className="httpToolHeaderRow" key={field.key}>
                    <Form.Item {...field} name={[field.name, "name"]} rules={[{ required: true }]}>
                      <Input placeholder="X-Tenant-ID" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "value"]} rules={[{ required: true }]}>
                      <Input placeholder="team-a" />
                    </Form.Item>
                    <Button danger type="text" onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  </div>
                ))}
                <Button onClick={() => add()}>添加 Header</Button>
              </div>
            )}
          </Form.List>
        </section>

        <div className="httpToolFormGrid httpToolFormSection">
          <Form.Item label="鉴权" name="authType">
            <Select
              options={[
                { label: "无鉴权", value: "none" },
                { label: "Bearer Token", value: "bearer" },
                { label: "API Key Header", value: "api_key_header" },
                { label: "OAuth2 Client Credentials", value: "oauth2_client_credentials" },
                { label: "自定义 Token 接口", value: "custom_token" }
              ]}
            />
          </Form.Item>
          {authType === "api_key_header" ? (
            <Form.Item label="API Key Header" name="authHeaderName" rules={[{ required: true }]}>
              <Input placeholder="X-API-Key" />
            </Form.Item>
          ) : (
            <div />
          )}
          {authType === "bearer" || authType === "api_key_header" ? (
            <Form.Item
              label="凭据"
              name="secret"
              extra={editing && secretConfigured ? "留空表示保留现有凭据。" : undefined}
              rules={editing && secretConfigured ? [] : [{ required: true, message: "请输入凭据" }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          ) : (
            <div />
          )}
        </div>

        {authType === "oauth2_client_credentials" ? (
          <section className="httpToolFormSection">
            <div className="httpToolSectionHeader">
              <strong>Client Credentials</strong>
            </div>
            <div className="httpToolFormGrid">
              <Form.Item
                className="httpToolFormFull"
                label="Token URL"
                name={["authConfig", "tokenUrl"]}
                rules={[{ required: true, message: "请输入 Token URL" }]}
              >
                <Input placeholder="https://auth.example.com/oauth/token" />
              </Form.Item>
              <Form.Item label="客户端认证方式" name={["authConfig", "clientAuthMethod"]}>
                <Select
                  options={[
                    { label: "请求体 client_id / client_secret", value: "body" },
                    { label: "HTTP Basic", value: "basic" }
                  ]}
                />
              </Form.Item>
              <div />
              <Form.Item
                label="Client ID"
                name="clientId"
                extra={editing && secretConfigured ? "留空表示保留现有值。" : undefined}
                rules={
                  editing && secretConfigured
                    ? []
                    : [{ required: true, message: "请输入 Client ID" }]
                }
              >
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                label="Client Secret"
                name="clientSecret"
                extra={editing && secretConfigured ? "留空表示保留现有值。" : undefined}
                rules={
                  editing && secretConfigured
                    ? []
                    : [{ required: true, message: "请输入 Client Secret" }]
                }
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item label="Scope" name={["authConfig", "scope"]}>
                <Input placeholder="orders.read" />
              </Form.Item>
              <Form.Item label="Audience" name={["authConfig", "audience"]}>
                <Input />
              </Form.Item>
            </div>
            <TokenResponseFields />
          </section>
        ) : null}

        {authType === "custom_token" ? (
          <section className="httpToolFormSection">
            <div className="httpToolSectionHeader">
              <strong>自定义 Token 请求</strong>
            </div>
            <div className="httpToolFormGrid">
              <Form.Item
                className="httpToolFormFull"
                label="Token URL"
                name={["authConfig", "tokenUrl"]}
                rules={[{ required: true, message: "请输入 Token URL" }]}
              >
                <Input placeholder="http://auth-service:8080/api/token" />
              </Form.Item>
              <Form.Item label="请求方法" name={["authConfig", "method"]}>
                <Select options={[{ value: "GET" }, { value: "POST" }]} />
              </Form.Item>
              <Form.Item label="请求体格式" name={["authConfig", "contentType"]}>
                <Select
                  options={[
                    { label: "JSON", value: "application_json" },
                    { label: "Form URL Encoded", value: "form_urlencoded" }
                  ]}
                />
              </Form.Item>
              <Form.Item label="业务 Header" name={["authConfig", "headerName"]}>
                <Input placeholder="Authorization" />
              </Form.Item>
              <Form.Item label="Token 前缀" name={["authConfig", "tokenPrefix"]}>
                <Input placeholder="Bearer；留空表示直接注入" />
              </Form.Item>
            </div>

            <div className="httpToolSectionHeader">
              <strong>Token 请求参数</strong>
            </div>
            <Form.List name={["authConfig", "parameters"]}>
              {(fields, { add, remove }) => (
                <div className="httpToolRows">
                  {fields.map((field) => (
                    <div className="httpToolTokenParameterRow" key={field.key}>
                      <Form.Item
                        {...field}
                        name={[field.name, "name"]}
                        rules={[{ required: true }]}
                      >
                        <Input placeholder="client_secret" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "location"]}
                        rules={[{ required: true }]}
                      >
                        <Select options={["header", "query", "body"].map((value) => ({ value }))} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "value"]}>
                        <Input placeholder="固定值（二选一）" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "credentialKey"]}>
                        <Input placeholder="凭据键（二选一）" />
                      </Form.Item>
                      <Button danger type="text" onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </div>
                  ))}
                  <Button onClick={() => add({ location: "body" })}>添加 Token 参数</Button>
                </div>
              )}
            </Form.List>

            <div className="httpToolSectionHeader">
              <strong>加密凭据</strong>
            </div>
            <Form.List name="credentialEntries">
              {(fields, { add, remove }) => (
                <div className="httpToolRows">
                  {fields.map((field) => (
                    <div className="httpToolHeaderRow" key={field.key}>
                      <Form.Item {...field} name={[field.name, "key"]} rules={[{ required: true }]}>
                        <Input placeholder="clientSecret" />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "value"]}
                        extra={editing && secretConfigured ? "留空保留" : undefined}
                      >
                        <Input.Password autoComplete="new-password" />
                      </Form.Item>
                      <Button danger type="text" onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </div>
                  ))}
                  <Button onClick={() => add()}>添加凭据</Button>
                </div>
              )}
            </Form.List>
            <TokenResponseFields />
          </section>
        ) : null}

        <div className="httpToolFormGrid httpToolFormSection">
          <Form.Item label="允许访问私网" name="allowPrivateNetwork" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="超时（毫秒）" name="timeoutMs">
            <InputNumber min={1} max={30000} step={1000} />
          </Form.Item>
          <Form.Item label="最大响应（字节）" name="maxResponseBytes">
            <InputNumber min={1} max={5000000} step={100000} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

/** 两种动态鉴权共享 Token 响应映射与缓存时效配置。 */
function TokenResponseFields() {
  return (
    <div className="httpToolFormGrid">
      <Form.Item label="Token 字段" name={["authConfig", "tokenField"]}>
        <Input placeholder="access_token 或 data.accessToken" />
      </Form.Item>
      <Form.Item label="Token 类型字段" name={["authConfig", "tokenTypeField"]}>
        <Input placeholder="token_type" />
      </Form.Item>
      <Form.Item label="有效期秒数字段" name={["authConfig", "expiresInField"]}>
        <Input placeholder="expires_in" />
      </Form.Item>
      <Form.Item label="绝对过期时间字段" name={["authConfig", "expiresAtField"]}>
        <Input placeholder="expires_at（可选）" />
      </Form.Item>
      <Form.Item label="默认有效期（秒）" name={["authConfig", "defaultTtlSeconds"]}>
        <InputNumber min={10} max={86400} />
      </Form.Item>
      <Form.Item label="提前刷新（秒）" name={["authConfig", "refreshBeforeSeconds"]}>
        <InputNumber min={0} max={3600} />
      </Form.Item>
    </div>
  );
}
