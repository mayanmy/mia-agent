import { useEffect, useState } from "react";
import { App as AntdApp, Button, Form, Input, Modal, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { ToolsGuide } from "../../shared/components/menu-guides";

import {
  createHttpTool,
  deleteHttpTool,
  getHttpTool,
  listHttpTools,
  testHttpTool,
  updateHttpTool
} from "./api";
import type { HttpToolFormValues, HttpToolListItem } from "./api";
import { HttpToolFormModal } from "./components/HttpToolFormModal";
import "./tools.less";

const defaultValues: HttpToolFormValues = {
  name: "",
  slug: "",
  description: "",
  enabled: true,
  method: "GET",
  baseUrl: "",
  path: "/",
  parameters: [],
  fixedHeaders: [],
  authType: "none",
  authHeaderName: "X-API-Key",
  secret: undefined,
  authConfig: {
    clientAuthMethod: "body",
    method: "POST",
    contentType: "application_json",
    parameters: [],
    tokenField: "access_token",
    expiresInField: "expires_in",
    tokenTypeField: "token_type",
    headerName: "Authorization",
    tokenPrefix: "Bearer",
    defaultTtlSeconds: 300,
    refreshBeforeSeconds: 60
  },
  clientId: undefined,
  clientSecret: undefined,
  credentialEntries: [],
  timeoutMs: 10000,
  maxResponseBytes: 1000000,
  allowPrivateNetwork: false
};

export function ToolsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<HttpToolFormValues>();
  const [tools, setTools] = useState<HttpToolListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [testTool, setTestTool] = useState<HttpToolListItem | null>(null);
  const [testInput, setTestInput] = useState("{}");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setTools(await listHttpTools());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载工具失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setSecretConfigured(false);
    form.setFieldsValue(defaultValues);
    setDialogOpen(true);
  }

  async function openEdit(id: string) {
    setLoading(true);
    try {
      const tool = await getHttpTool(id);
      setEditingId(id);
      setSecretConfigured(tool.secretConfigured);
      form.setFieldsValue({
        ...tool,
        secret: undefined,
        clientId: undefined,
        clientSecret: undefined,
        credentialEntries: tool.credentialKeys.map((key) => ({ key, value: undefined }))
      });
      setDialogOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载工具详情失败");
    } finally {
      setLoading(false);
    }
  }

  async function submit(values: HttpToolFormValues) {
    setSaving(true);
    try {
      const { clientId, clientSecret, credentialEntries, ...basePayload } = values;
      let credentials: Record<string, string> | undefined;
      if (values.authType === "oauth2_client_credentials") {
        const entries = [
          ["clientId", clientId],
          ["clientSecret", clientSecret]
        ].filter((entry): entry is [string, string] => Boolean(entry[1]));
        credentials = entries.length > 0 ? Object.fromEntries(entries) : undefined;
      } else if (values.authType === "custom_token") {
        const entries = (credentialEntries ?? [])
          .filter((entry) => entry.key?.trim() && entry.value)
          .map((entry) => [entry.key.trim(), entry.value as string]);
        credentials = entries.length > 0 ? Object.fromEntries(entries) : undefined;
      }
      const payload = {
        ...basePayload,
        secret: values.secret || undefined,
        ...(credentials ? { credentials } : {})
      };
      if (editingId) {
        await updateHttpTool(editingId, payload);
        message.success("HTTP 工具已更新");
      } else {
        await createHttpTool(payload);
        message.success("HTTP 工具已创建");
      }
      setDialogOpen(false);
      form.resetFields();
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存工具失败");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(tool: HttpToolListItem) {
    Modal.confirm({
      title: "删除 HTTP 工具",
      content: `删除“${tool.name}”后，已绑定该工具的 Agent 将不再加载它。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await deleteHttpTool(tool.id);
        message.success("HTTP 工具已删除");
        await refresh();
      }
    });
  }

  async function runTest() {
    if (!testTool) return;
    setTesting(true);
    try {
      const parsed = JSON.parse(testInput) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("测试参数必须是 JSON 对象");
      }
      const result = await testHttpTool(testTool.id, parsed as Record<string, unknown>);
      setTestResult(JSON.stringify(result, null, 2));
      if (result.ok) message.success("测试调用完成");
      else message.error(result.errorMessage || "测试调用失败");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试参数不正确");
    } finally {
      setTesting(false);
    }
  }

  const columns: TableProps<HttpToolListItem>["columns"] = [
    { title: "名称", dataIndex: "name", width: 180 },
    {
      title: "方法",
      dataIndex: "method",
      width: 90,
      render: (method) => <Tag color={method === "GET" ? "blue" : "green"}>{method}</Tag>
    },
    {
      title: "目标",
      width: 340,
      render: (_, tool) => (
        <code className="httpToolTarget">
          {tool.baseUrl}
          {tool.path}
        </code>
      )
    },
    {
      title: "鉴权",
      dataIndex: "authType",
      width: 190,
      render: (authType, tool) =>
        authType === "none" ? (
          "无"
        ) : (
          <Tag color={tool.secretConfigured ? "green" : "red"}>
            {formatAuthType(authType)} · {tool.secretConfigured ? "已配置" : "缺少凭据"}
          </Tag>
        )
    },
    {
      title: "私网",
      dataIndex: "allowPrivateNetwork",
      width: 90,
      render: (allowed) => (allowed ? <Tag color="orange">允许</Tag> : "禁止")
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 90,
      render: (enabled) => (
        <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "操作",
      fixed: "right",
      width: 190,
      render: (_, tool) => (
        <Space size={2}>
          <Button
            size="small"
            type="link"
            onClick={() => {
              setTestTool(tool);
              setTestInput("{}");
              setTestResult("");
            }}
          >
            测试
          </Button>
          <Button size="small" type="link" onClick={() => void openEdit(tool.id)}>
            编辑
          </Button>
          <Button danger size="small" type="link" onClick={() => confirmDelete(tool)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace toolsWorkspace">
      <WorkspacePageHeader
        actions={
          <>
            <ToolsGuide />
            <Button disabled={loading} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button type="primary" onClick={openCreate}>
              新增 HTTP 工具
            </Button>
          </>
        }
        description="配置受控 HTTP API，让 Agent 只填写业务参数。"
        title="工具"
      />
      <section className="panel toolsTablePanel">
        <Table
          columns={columns}
          dataSource={tools}
          loading={loading}
          pagination={false}
          rowKey="id"
          scroll={{ x: 1100 }}
        />
      </section>
      <HttpToolFormModal
        editing={Boolean(editingId)}
        form={form}
        open={dialogOpen}
        saving={saving}
        secretConfigured={secretConfigured}
        onCancel={() => {
          setDialogOpen(false);
          form.resetFields();
        }}
        onSubmit={(values) => void submit(values)}
      />
      <Modal
        confirmLoading={testing}
        okText="执行测试"
        open={Boolean(testTool)}
        title={`测试 ${testTool?.name ?? "HTTP 工具"}`}
        width={680}
        onCancel={() => setTestTool(null)}
        onOk={() => void runTest()}
      >
        <label className="httpToolTestLabel" htmlFor="http-tool-test-input">
          业务参数 JSON
        </label>
        <Input.TextArea
          id="http-tool-test-input"
          rows={8}
          value={testInput}
          onChange={(event) => setTestInput(event.target.value)}
        />
        {testResult ? <pre className="httpToolTestResult">{testResult}</pre> : null}
      </Modal>
    </section>
  );
}

function formatAuthType(authType: HttpToolListItem["authType"]): string {
  if (authType === "bearer") return "Bearer";
  if (authType === "api_key_header") return "API Key";
  if (authType === "oauth2_client_credentials") return "Client Credentials";
  if (authType === "custom_token") return "自定义 Token";
  return "无";
}
