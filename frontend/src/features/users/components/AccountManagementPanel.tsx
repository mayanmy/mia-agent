import { useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag
} from "antd";

import { WorkspacePageHeader } from "../../../shared/components/WorkspacePageHeader";
import type { UserRole } from "../../auth/types";
import {
  createUser,
  listUsers,
  resetPassword,
  revokeSessions,
  updateUser,
  type ManagedUser
} from "../users.api";

type CreateAccountFormValues = {
  email: string;
  displayName: string;
  password: string;
  role: UserRole;
};

type ResetPasswordFormValues = {
  password: string;
};

const passwordRules = [
  { required: true, message: "请输入密码" },
  { min: 8, message: "密码至少需要 8 位" },
  {
    validator: async (_: unknown, value: string | undefined) => {
      if (!value || (/[a-zA-Z]/u.test(value) && /[0-9]/u.test(value))) return;
      throw new Error("密码需要同时包含字母和数字");
    }
  }
];

/** 平台管理员维护登录账号；项目空间成员关系由相邻页签独立管理。 */
export function AccountManagementPanel() {
  const { message } = AntdApp.useApp();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);
  const [createForm] = Form.useForm<CreateAccountFormValues>();
  const [passwordForm] = Form.useForm<ResetPasswordFormValues>();

  async function loadUsers(isActive: () => boolean = () => true) {
    if (!isActive()) return;
    setLoading(true);
    try {
      const page = await listUsers(1, 100, keyword);
      if (isActive()) setUsers(page.list);
    } catch (error) {
      if (isActive()) message.error(error instanceof Error ? error.message : "加载账号失败");
    } finally {
      if (isActive()) setLoading(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    void loadUsers(() => !disposed);
    return () => {
      disposed = true;
    };
  }, []);

  async function submitCreate(values: CreateAccountFormValues) {
    setSaving(true);
    try {
      await createUser(values);
      setCreateOpen(false);
      createForm.resetFields();
      await loadUsers();
      message.success("成员账号已创建，可在项目空间成员页签邀请其加入当前空间");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建成员账号失败");
    } finally {
      setSaving(false);
    }
  }

  async function patchUser(user: ManagedUser, payload: { role?: UserRole; enabled?: boolean }) {
    try {
      await updateUser(user.id, payload);
      await loadUsers();
      message.success("账号已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新账号失败");
    }
  }

  async function submitPassword(values: ResetPasswordFormValues) {
    if (!passwordTarget) return;
    setSaving(true);
    try {
      await resetPassword(passwordTarget.id, values.password);
      setPasswordTarget(null);
      passwordForm.resetFields();
      message.success("密码已重置，该成员需要重新登录");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeSessions(userId: string) {
    try {
      await revokeSessions(userId);
      message.success("该账号的登录会话已撤销");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "撤销会话失败");
    }
  }

  return (
    <section className="workspace">
      <WorkspacePageHeader
        title="账号管理"
        description="创建和维护平台登录账号；账号加入具体项目空间后才能访问空间数据。"
        actions={
          <Space wrap>
            <Input
              placeholder="搜索邮箱或名称"
              style={{ width: 280 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => void loadUsers()}
            />
            <Button onClick={() => void loadUsers()}>查询</Button>
            <Button
              type="primary"
              onClick={() => {
                createForm.setFieldsValue({ role: "USER" });
                setCreateOpen(true);
              }}
            >
              新增成员
            </Button>
          </Space>
        }
      />

      <Table<ManagedUser>
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={[
          {
            title: "成员",
            render: (_, user) => (
              <div>
                <strong>{user.displayName}</strong>
                <div>{user.email}</div>
              </div>
            )
          },
          {
            title: "平台角色",
            width: 180,
            render: (_, user) => (
              <Select
                value={user.role}
                onChange={(role) => void patchUser(user, { role })}
                options={[
                  { value: "ADMIN", label: "管理员" },
                  { value: "USER", label: "成员" }
                ]}
              />
            )
          },
          {
            title: "状态",
            width: 180,
            render: (_, user) => (
              <Space>
                <Switch
                  checked={!user.disabledAt}
                  onChange={(enabled) => void patchUser(user, { enabled })}
                />
                <Tag color={user.disabledAt ? "default" : "green"}>
                  {user.disabledAt ? "已禁用" : "已启用"}
                </Tag>
              </Space>
            )
          },
          {
            title: "最近登录",
            dataIndex: "lastLoginAt",
            width: 210,
            render: (value: string | null) =>
              value ? new Date(value).toLocaleString("zh-CN") : "-"
          },
          {
            title: "操作",
            width: 220,
            render: (_, user) => (
              <Space>
                <Button type="link" onClick={() => setPasswordTarget(user)}>
                  重置密码
                </Button>
                <Popconfirm
                  title="确认撤销该成员全部登录会话？"
                  onConfirm={() => handleRevokeSessions(user.id)}
                >
                  <Button type="link">撤销会话</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />

      <Modal
        title="新增成员"
        open={createOpen}
        confirmLoading={saving}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={() => void createForm.validateFields().then(submitCreate)}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="displayName" label="名称" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={passwordRules}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="平台角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "USER", label: "成员" },
                { value: "ADMIN", label: "管理员" }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码：${passwordTarget?.displayName ?? ""}`}
        open={Boolean(passwordTarget)}
        confirmLoading={saving}
        onCancel={() => {
          setPasswordTarget(null);
          passwordForm.resetFields();
        }}
        onOk={() => void passwordForm.validateFields().then(submitPassword)}
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={passwordRules}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
