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
  Table,
  Tag,
  Typography
} from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import {
  createWorkspace,
  createWorkspaceInvitation,
  listWorkspaceMembers,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  updateWorkspace,
  updateWorkspaceMemberRole
} from "../workspaces/api";
import {
  WorkspaceSettingsModal,
  type WorkspaceSettingsValues
} from "../workspaces/components/WorkspaceSettingsModal";
import { useWorkspace } from "../workspaces/WorkspaceProvider";
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from "../workspaces/types";

type InvitationFormValues = {
  email: string;
  displayName: string;
  role: "MANAGER" | "MEMBER";
};

type WorkspaceFormValues = {
  name: string;
  description?: string;
};

/** 项目空间 OWNER 管理当前空间成员，不包含平台账号安全操作。 */
export function UsersPage() {
  return <WorkspaceMembersPanel />;
}

/** 当前项目空间的成员关系、角色、邀请和所有权操作。 */
function WorkspaceMembersPanel() {
  const { message } = AntdApp.useApp();
  const { currentWorkspace, refreshWorkspaces } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(null);
  const [invitationForm] = Form.useForm<InvitationFormValues>();
  const [workspaceForm] = Form.useForm<WorkspaceFormValues>();

  async function refreshMembers() {
    if (!currentWorkspace) return;
    setLoading(true);
    try {
      setMembers(await listWorkspaceMembers(currentWorkspace.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载项目空间成员失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshMembers();
  }, [currentWorkspace?.id]);

  async function submitInvitation(values: InvitationFormValues) {
    if (!currentWorkspace) return;
    setSaving(true);
    try {
      const created = await createWorkspaceInvitation(currentWorkspace.id, values);
      setInvitation(created);
      setInvitationOpen(false);
      invitationForm.resetFields();
      message.success("项目空间邀请已生成");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "生成邀请失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitWorkspace(values: WorkspaceFormValues) {
    setSaving(true);
    try {
      const created = await createWorkspace(values);
      await refreshWorkspaces(created.id);
      setWorkspaceOpen(false);
      workspaceForm.resetFields();
      message.success("项目空间已创建");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建项目空间失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitWorkspaceSettings(values: WorkspaceSettingsValues) {
    if (!currentWorkspace) return;
    setSaving(true);
    try {
      await updateWorkspace(currentWorkspace.id, values);
      await refreshWorkspaces(currentWorkspace.id);
      setWorkspaceSettingsOpen(false);
      message.success("项目空间资料已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新项目空间失败");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: WorkspaceMember, role: "MANAGER" | "MEMBER") {
    if (!currentWorkspace) return;
    try {
      await updateWorkspaceMemberRole(currentWorkspace.id, member.userId, role);
      await refreshMembers();
      message.success("成员角色已更新");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新成员角色失败");
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!currentWorkspace) return;
    try {
      await removeWorkspaceMember(currentWorkspace.id, member.userId);
      await Promise.all([refreshMembers(), refreshWorkspaces()]);
      message.success("成员已移出项目空间");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "移除成员失败");
    }
  }

  async function transferOwnership(member: WorkspaceMember) {
    if (!currentWorkspace) return;
    try {
      await transferWorkspaceOwnership(currentWorkspace.id, member.userId);
      await Promise.all([refreshMembers(), refreshWorkspaces()]);
      message.success("项目空间所有权已转让");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "转让所有权失败");
    }
  }

  if (!currentWorkspace) return null;

  const canManageAdmins = currentWorkspace.role === "OWNER";
  const columns: TableProps<WorkspaceMember>["columns"] = [
    {
      title: "成员",
      key: "member",
      render: (_, member) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{member.displayName}</Typography.Text>
          <Typography.Text type="secondary">{member.email}</Typography.Text>
        </Space>
      )
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 180,
      render: (role: WorkspaceRole, member) => {
        if (role === "OWNER") return <Tag color="gold">所有者</Tag>;
        if (!canManageAdmins) {
          return <Tag color={role === "MANAGER" ? "blue" : "default"}>{roleLabel(role)}</Tag>;
        }
        return (
          <Select
            options={[
              { label: "项目管理员", value: "MANAGER" },
              { label: "成员", value: "MEMBER" }
            ]}
            value={role}
            onChange={(nextRole) => void changeRole(member, nextRole)}
          />
        );
      }
    },
    {
      title: "加入时间",
      dataIndex: "joinedAt",
      width: 190,
      render: (value: string) => new Date(value).toLocaleString("zh-CN")
    },
    {
      title: "操作",
      key: "actions",
      width: 210,
      render: (_, member) => {
        if (member.role === "OWNER") return null;
        if (currentWorkspace.role === "MANAGER" && member.role !== "MEMBER") return null;
        return (
          <Space>
            {currentWorkspace.role === "OWNER" ? (
              <Popconfirm
                title="确认把项目空间所有权转让给该成员？"
                onConfirm={() => transferOwnership(member)}
              >
                <Button size="small" type="link">
                  转让所有权
                </Button>
              </Popconfirm>
            ) : null}
            <Popconfirm
              title="确认将该成员移出当前项目空间？"
              onConfirm={() => removeMember(member)}
            >
              <Button danger size="small" type="link">
                移除
              </Button>
            </Popconfirm>
          </Space>
        );
      }
    }
  ];

  return (
    <section className="workspace">
      <WorkspacePageHeader
        eyebrow="Workspace Settings"
        title="项目空间管理"
        description={`管理“${currentWorkspace.name}”的资料、成员和空间内角色。`}
        actions={
          <Space>
            <Button onClick={() => setWorkspaceSettingsOpen(true)}>编辑项目空间</Button>
            <Button onClick={() => setWorkspaceOpen(true)}>新建项目空间</Button>
            <Button
              type="primary"
              onClick={() => {
                invitationForm.setFieldsValue({ role: "MEMBER" });
                setInvitationOpen(true);
              }}
            >
              邀请成员
            </Button>
          </Space>
        }
      />

      <Table<WorkspaceMember>
        columns={columns}
        dataSource={members}
        loading={loading}
        pagination={false}
        rowKey="userId"
      />

      <WorkspaceSettingsModal
        open={workspaceSettingsOpen}
        saving={saving}
        workspace={currentWorkspace}
        onCancel={() => setWorkspaceSettingsOpen(false)}
        onSubmit={(values) => void submitWorkspaceSettings(values)}
      />

      <Modal
        confirmLoading={saving}
        open={invitationOpen}
        title="邀请成员加入项目空间"
        onCancel={() => setInvitationOpen(false)}
        onOk={() => void invitationForm.validateFields().then(submitInvitation)}
      >
        <Form form={invitationForm} layout="vertical">
          <Form.Item label="邮箱" name="email" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="成员名称" name="displayName" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item label="空间角色" name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "成员", value: "MEMBER" },
                ...(canManageAdmins ? [{ label: "项目管理员", value: "MANAGER" as const }] : [])
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        confirmLoading={saving}
        open={workspaceOpen}
        title="新建项目空间"
        onCancel={() => setWorkspaceOpen(false)}
        onOk={() => void workspaceForm.validateFields().then(submitWorkspace)}
      >
        <Form form={workspaceForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea maxLength={500} rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        footer={null}
        open={Boolean(invitation)}
        title="项目空间邀请已生成"
        onCancel={() => setInvitation(null)}
      >
        <Typography.Paragraph>请将下面的一次性链接发送给受邀用户：</Typography.Paragraph>
        <Input.TextArea readOnly rows={4} value={invitation?.activateUrl} />
        <Button
          style={{ marginTop: 12 }}
          type="primary"
          onClick={() => {
            if (invitation?.activateUrl) {
              void navigator.clipboard.writeText(invitation.activateUrl);
              message.success("邀请链接已复制");
            }
          }}
        >
          复制邀请链接
        </Button>
      </Modal>
    </section>
  );
}

function roleLabel(role: WorkspaceRole): string {
  return role === "OWNER" ? "所有者" : role === "MANAGER" ? "项目管理员" : "成员";
}
