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

import type { UserRole } from "../auth/types";
import {
  createUser,
  listUsers,
  resetPassword,
  revokeSessions,
  updateUser,
  type ManagedUser
} from "./users.api";

/** 管理员维护团队成员、角色和会话的页面。 */
export function UsersPage() {
  const { message } = AntdApp.useApp();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<ManagedUser | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  /** 重新加载成员列表，操作成功后复用此入口保持列表状态一致。 */
  async function loadUsers() {
    setLoading(true);
    try {
      setUsers((await listUsers(1, 100, keyword)).list);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载成员失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  /** 创建成员后关闭表单并刷新列表，密码字段不会留在页面状态中。 */
  async function submitCreate(values: {
    email: string;
    displayName: string;
    password: string;
    role: UserRole;
  }) {
    await createUser(values);
    message.success("成员已创建");
    setCreateOpen(false);
    form.resetFields();
    await loadUsers();
  }

  /** 修改角色或启用状态；后端负责校验最后一个管理员保护规则。 */
  async function patchUser(user: ManagedUser, payload: { role?: UserRole; enabled?: boolean }) {
    try {
      await updateUser(user.id, payload);
      message.success("成员已更新");
      await loadUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新成员失败");
    }
  }

  /** 提交新密码，成功后后端会撤销该成员的全部会话。 */
  async function submitPassword(values: { password: string }) {
    if (!passwordTarget) return;
    await resetPassword(passwordTarget.id, values.password);
    message.success("密码已重置，成员需要重新登录");
    setPasswordTarget(null);
    passwordForm.resetFields();
  }

  return (
    <section className="workspace">
      <header className="compactPageHeader">
        <div>
          <h1>成员管理</h1>
          <p>管理工作台成员、角色和登录会话。</p>
        </div>
        <Space>
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => void loadUsers()}
            placeholder="搜索邮箱或名称"
          />
          <Button onClick={() => void loadUsers()}>查询</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新增成员
          </Button>
        </Space>
      </header>
      <Table
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
            title: "角色",
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
            render: (value) => (value ? new Date(value).toLocaleString() : "-")
          },
          {
            title: "操作",
            render: (_, user) => (
              <Space>
                <Button type="link" onClick={() => setPasswordTarget(user)}>
                  重置密码
                </Button>
                <Popconfirm
                  title="确认撤销该成员全部登录会话？"
                  onConfirm={() =>
                    revokeSessions(user.id).then(() => message.success("会话已撤销"))
                  }
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
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ role: "USER" }}
          onFinish={(values) => void submitCreate(values)}
        >
          <Form.Item name="displayName" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 12 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: "ADMIN", label: "管理员" },
                { value: "USER", label: "成员" }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`重置密码：${passwordTarget?.displayName ?? ""}`}
        open={Boolean(passwordTarget)}
        onCancel={() => setPasswordTarget(null)}
        onOk={() => passwordForm.submit()}
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) => void submitPassword(values)}
        >
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 12 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
