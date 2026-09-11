import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Typography
} from "antd";

import {
  getAgentPublicAccess,
  rotateAgentPublicToken,
  updateAgentPublicAccess,
  type AgentPublicAccessConfig
} from "../api";
import type { AgentTableItem } from "../types";

/** 公开访问安全设置表单值。 */
type PublicAccessFormValues = {
  /** 本地日期时间字符串；为空表示不修改。 */
  publicExpiresAt?: string;
  /** 每行一个的 Widget 来源白名单文本。 */
  allowedOrigins?: string;
  /** 待设置的新访问密码。 */
  password?: string;
  /** 是否明确清除已有访问密码。 */
  clearPassword?: boolean;
};

/** 公开访问设置弹窗参数。 */
type AgentPublicAccessModalProps = {
  /** 当前 Agent；null 表示关闭弹窗。 */
  agent: AgentTableItem | null;
  /** 关闭弹窗回调。 */
  onCancel: () => void;
  /** 分享令牌轮换成功后的列表刷新回调。 */
  onTokenRotated: () => void;
};

/** Agent 发布后的安全设置独立于编辑表单，避免普通 Prompt 修改误触公开访问策略。 */
export function AgentPublicAccessModal({
  agent,
  onCancel,
  onTokenRotated
}: AgentPublicAccessModalProps) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<PublicAccessFormValues>();
  const [config, setConfig] = useState<AgentPublicAccessConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!agent) {
      return undefined;
    }

    setLoading(true);
    setNewToken(null);
    void getAgentPublicAccess(agent.id)
      .then((result) => {
        if (disposed) {
          return;
        }
        setConfig(result);
        form.setFieldsValue({
          publicExpiresAt: toDateTimeLocal(result.publicExpiresAt),
          allowedOrigins: result.allowedOrigins.join("\n"),
          password: "",
          clearPassword: false
        });
      })
      .catch((error) => {
        if (!disposed) {
          message.error(error instanceof Error ? error.message : "加载公开访问配置失败");
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [agent, form]);

  async function handleSave(values: PublicAccessFormValues) {
    if (!agent) {
      return;
    }

    setSaving(true);
    try {
      const result = await updateAgentPublicAccess(agent.id, {
        publicExpiresAt: values.publicExpiresAt || null,
        allowedOrigins: (values.allowedOrigins || "")
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean),
        ...(values.clearPassword
          ? { password: null }
          : values.password?.trim()
            ? { password: values.password.trim() }
            : {})
      });
      setConfig(result);
      form.setFieldsValue({ password: "", clearPassword: false });
      message.success("公开访问配置已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存公开访问配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateToken() {
    if (!agent) {
      return;
    }

    try {
      const result = await rotateAgentPublicToken(agent.id);
      setNewToken(result.shareToken);
      onTokenRotated();
      message.success("公开 Token 已轮换，旧链接已失效");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "轮换 Token 失败");
    }
  }

  return (
    <Modal
      destroyOnClose
      footer={null}
      open={Boolean(agent)}
      title={`公开访问设置${agent ? ` · ${agent.name}` : ""}`}
      onCancel={onCancel}
    >
      <Form<PublicAccessFormValues> form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item label="公开链接到期时间" extra="留空表示不设置到期时间。" name="publicExpiresAt">
          <Input type="datetime-local" />
        </Form.Item>
        <Form.Item
          extra="每行一个完整 Origin，例如 https://app.example.com。留空表示允许任何来源。"
          label="允许嵌入的域名"
          name="allowedOrigins"
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="https://app.example.com"
          />
        </Form.Item>
        <Form.Item
          extra={
            config?.passwordRequired
              ? "当前已启用访问密码；留空可保留当前密码。为了安全性设计，已经设置的访问密码不会回显"
              : "设置后，每次刷新 Widget 都需要重新输入。为公开链接增加一道访问保护。启用后，外部用户打开分享页或嵌入式 Widget 时，需先输入正确密码才能查看历史消息和开始对话。"
          }
          label="访问密码"
          name="password"
        >
          <Input.Password placeholder="至少 8 位，包含字母和数字" />
        </Form.Item>
        {config?.passwordRequired ? (
          <Form.Item label="关闭当前访问密码" name="clearPassword" valuePropName="checked">
            <Switch checkedChildren="关闭" unCheckedChildren="保留" />
          </Form.Item>
        ) : null}
        {newToken ? (
          <Typography.Paragraph copyable={{ text: newToken }}>
            新 Token：<Typography.Text code>{newToken}</Typography.Text>
          </Typography.Paragraph>
        ) : null}
        <Space style={{ display: "flex", justifyContent: "space-between" }}>
          <Popconfirm
            okText="确认轮换"
            title="轮换后旧公开链接和嵌入代码会立即失效，确认继续吗？"
            onConfirm={() => void handleRotateToken()}
          >
            <Button danger disabled={!agent?.published}>
              轮换 Token
            </Button>
          </Popconfirm>
          <Space>
            <Button onClick={onCancel}>取消</Button>
            <Button htmlType="submit" loading={saving || loading} type="primary">
              保存
            </Button>
          </Space>
        </Space>
      </Form>
    </Modal>
  );
}

/** datetime-local 不接受时区后缀，使用本地时间展示但保存时会转换回标准 ISO 时间。 */
function toDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
