import { useEffect, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag
} from "antd";
import type { TableProps } from "antd";

import {
  createAgentApiKey,
  listAgentApiKeys,
  revokeAgentApiKey,
  rotateAgentApiKey,
  type AgentApiKeyListItem,
  type CreatedAgentApiKey
} from "../api";
import type { AgentTableItem } from "../types";

/** API Key 创建表单值。 */
type AgentApiKeyFormValues = {
  /** 便于管理员识别用途的 Key 名称。 */
  name: string;
};

/** API Key 管理弹窗参数。 */
type AgentApiKeysModalProps = {
  /** 当前管理的 Agent；null 表示关闭弹窗。 */
  agent: AgentTableItem | null;
  /** 关闭弹窗回调。 */
  onCancel: () => void;
};

/** 管理 Agent API Key 生命周期，完整密钥仅在创建或轮换后短暂展示。 */
export function AgentApiKeysModal({
  agent,
  onCancel
}: AgentApiKeysModalProps) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<AgentApiKeyFormValues>();
  const [keys, setKeys] = useState<AgentApiKeyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rawKey, setRawKey] = useState<CreatedAgentApiKey | null>(null);

  useEffect(() => {
    let disposed = false;

    if (!agent) {
      setKeys([]);
      setRawKey(null);
      form.resetFields();
      return undefined;
    }

    void loadKeys(agent.id, () => !disposed);

    return () => {
      // 切换 Agent 或关闭弹窗时使旧请求失效，避免 Key 列表串到另一条 Agent 记录。
      disposed = true;
    };
  }, [agent?.id]);

  /** 重新读取 Key 生命周期状态；撤销、轮换后始终以服务端结果为准。 */
  async function loadKeys(agentId: string, isActive: () => boolean = () => true) {
    setLoading(true);

    try {
      const result = await listAgentApiKeys(agentId);
      if (isActive()) {
        setKeys(result);
      }
    } catch (error) {
      if (isActive()) {
        message.error(error instanceof Error ? error.message : "加载 Agent API Key 失败");
      }
    } finally {
      if (isActive()) {
        setLoading(false);
      }
    }
  }

  /** 创建 Key 后立刻展示唯一一次明文，并刷新表格以显示安全前缀。 */
  async function handleCreate() {
    if (!agent) {
      return;
    }

    const values = await form.validateFields();
    setCreating(true);

    try {
      const result = await createAgentApiKey(agent.id, { name: values.name });
      setRawKey(result);
      form.resetFields();
      await loadKeys(agent.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建 Agent API Key 失败");
    } finally {
      setCreating(false);
    }
  }

  /** 撤销后立即刷新，前端不会继续把已失效 Key 误展示为可用。 */
  async function handleRevoke(keyId: string) {
    if (!agent) {
      return;
    }

    try {
      await revokeAgentApiKey(agent.id, keyId);
      message.success("Agent API Key 已撤销");
      await loadKeys(agent.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "撤销 Agent API Key 失败");
    }
  }

  /** 轮换同样只显示一次新明文，因此会覆盖此前未复制的临时展示。 */
  async function handleRotate(keyId: string) {
    if (!agent) {
      return;
    }

    try {
      const result = await rotateAgentApiKey(agent.id, keyId);
      setRawKey(result);
      await loadKeys(agent.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "轮换 Agent API Key 失败");
    }
  }

  /** 使用剪贴板 API 复制明文，页面不在本地存储中持久化任何 Agent API Key。 */
  async function copyRawKey() {
    if (!rawKey) {
      return;
    }

    await navigator.clipboard.writeText(rawKey.apiKey);
    message.success("Agent API Key 已复制");
  }

  const columns: TableProps<AgentApiKeyListItem>["columns"] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name"
    },
    {
      title: "Key 前缀",
      dataIndex: "keyPrefix",
      key: "keyPrefix",
      render: (keyPrefix: string) => `${keyPrefix}...`
    },
    {
      title: "状态",
      key: "status",
      render: (_, record) =>
        record.revokedAt ? <Tag>已撤销</Tag> : <Tag color="green">可用</Tag>
    },
    {
      title: "最近使用",
      dataIndex: "lastUsedAt",
      key: "lastUsedAt",
      render: (value: string | null) => (value ? formatDate(value) : "未使用")
    },
    {
      title: "操作",
      key: "actions",
      render: (_, record) =>
        record.revokedAt ? null : (
          <Space size={4}>
            <Popconfirm
              cancelText="取消"
              okText="轮换"
              title="轮换后旧 Key 会立即失效，确认继续？"
              onConfirm={() => void handleRotate(record.id)}
            >
              <Button size="small" type="link">
                轮换
              </Button>
            </Popconfirm>
            <Popconfirm
              cancelText="取消"
              okButtonProps={{ danger: true }}
              okText="撤销"
              title="撤销后无法恢复，确认继续？"
              onConfirm={() => void handleRevoke(record.id)}
            >
              <Button danger size="small" type="link">
                撤销
              </Button>
            </Popconfirm>
          </Space>
        )
    }
  ];

  return (
    <Modal footer={null} open={Boolean(agent)} title={`${agent?.name ?? ""} · 服务端 API Key`} width={860} onCancel={onCancel}>
      <Alert
        showIcon
        type="warning"
        message="完整 Key 只显示一次，请立即保存到业务后端；不要放入浏览器、小程序或 Widget。"
      />
      {rawKey ? (
        <div className="agentApiKeyReveal">
          <Input.Password readOnly value={rawKey.apiKey} visibilityToggle={{ visible: true }} />
          <Button type="primary" onClick={() => void copyRawKey()}>
            复制 Key
          </Button>
        </div>
      ) : null}
      <Form className="agentApiKeyCreateForm" form={form} layout="inline" onFinish={() => void handleCreate()}>
        <Form.Item name="name" rules={[{ required: true, message: "请输入部署名称" }]}>
          <Input maxLength={80} placeholder="例如：衣间录生产环境" />
        </Form.Item>
        <Button htmlType="submit" loading={creating} type="primary">
          新增 Key
        </Button>
      </Form>
      <Table
        columns={columns}
        dataSource={keys}
        loading={loading}
        pagination={false}
        rowKey="id"
        scroll={{ x: 680 }}
        size="small"
      />
    </Modal>
  );
}

/** 统一用本地中文时间展示 Key 的创建和最近使用状态，便于管理员排查部署环境。 */
function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
