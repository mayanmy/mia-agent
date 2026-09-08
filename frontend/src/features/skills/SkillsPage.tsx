import { useEffect, useState } from "react";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip
} from "antd";
import type { TableProps } from "antd";

import { WorkspacePageHeader } from "../../shared/components/WorkspacePageHeader";
import { SkillsGuide } from "../../shared/components/menu-guides";
import {
  archiveSkill,
  createSkill,
  listSkills,
  updateSkill,
  updateSkillStatus,
  type SkillDetail,
  type SkillFormValues
} from "./api";
import "./skills.less";

const EMPTY_SKILL: SkillFormValues = {
  name: "",
  description: "",
  instructions: "",
  usageConditions: "",
  inputGuidance: "",
  outputGuidance: "",
  limitations: ""
};

export function SkillsPage() {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<SkillFormValues>();
  const [skills, setSkills] = useState<SkillDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<SkillDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setSkills((await listSkills()).list);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载 Skill 失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    form.setFieldsValue(EMPTY_SKILL);
    setFormOpen(true);
  }

  function openEdit(skill: SkillDetail) {
    setEditing(skill);
    form.setFieldsValue(skill);
    setFormOpen(true);
  }

  async function submit(values: SkillFormValues) {
    setSaving(true);
    try {
      if (editing) {
        // revision 作为乐观锁提交，避免覆盖另一管理员刚保存的内容。
        await updateSkill(editing.id, { ...values, expectedRevision: editing.revision });
        message.success("Skill 已更新");
      } else {
        await createSkill(values);
        message.success("Skill 已创建");
      }
      setFormOpen(false);
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存 Skill 失败");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(skill: SkillDetail, enabled: boolean) {
    try {
      // 状态切换同样携带 revision，服务端拒绝基于旧列表快照的更新。
      const updated = await updateSkillStatus(skill.id, enabled, skill.revision);
      setSkills((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新 Skill 状态失败");
    }
  }

  function confirmArchive(skill: SkillDetail) {
    Modal.confirm({
      title: "归档 Skill",
      content: `归档“${skill.name}”后将不能再启用。`,
      okText: "归档",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await archiveSkill(skill.id);
        message.success("Skill 已归档");
        await refresh();
      }
    });
  }

  const columns: TableProps<SkillDetail>["columns"] = [
    {
      title: "Skill",
      render: (_, skill) => (
        <div className="skillIdentity">
          <strong>{skill.name}</strong>
          <span>{skill.description || "暂无描述"}</span>
        </div>
      )
    },
    {
      title: "来源",
      dataIndex: "sourceType",
      width: 130,
      render: (source: string) => (
        <Tag color={source === "mcp_prompt" ? "blue" : undefined}>
          {source === "mcp_prompt" ? "MCP Prompt" : "手动创建"}
        </Tag>
      )
    },
    { title: "修订", dataIndex: "revision", width: 80 },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (enabled: boolean, skill) => (
        <Switch
          checked={enabled}
          size="small"
          onChange={(value) => void changeStatus(skill, value)}
        />
      )
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString()
    },
    {
      title: "操作",
      width: 100,
      render: (_, skill) => (
        <Space size={0}>
          <Tooltip title="编辑">
            <Button icon={<EditOutlined />} type="text" onClick={() => openEdit(skill)} />
          </Tooltip>
          <Tooltip title="归档">
            <Button
              danger
              icon={<DeleteOutlined />}
              type="text"
              onClick={() => confirmArchive(skill)}
            />
          </Tooltip>
        </Space>
      )
    }
  ];

  return (
    <section className="workspace">
      <WorkspacePageHeader
        actions={
          <>
            <SkillsGuide />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreate}>
              新增 Skill
            </Button>
          </>
        }
        description="管理可复用的专业指令。Skill 不会自动获得工具或知识库权限。"
        title="Skill"
      />
      <section className="panel skillTablePanel">
        <Table
          columns={columns}
          dataSource={skills}
          loading={loading}
          pagination={false}
          rowKey="id"
          scroll={{ x: 900 }}
        />
      </section>
      <Modal
        confirmLoading={saving}
        open={formOpen}
        title={editing ? "编辑 Skill" : "新增 Skill"}
        okText="保存"
        cancelText="取消"
        width={760}
        onCancel={() => setFormOpen(false)}
        onOk={() => void form.validateFields().then(submit)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea maxLength={500} rows={2} />
          </Form.Item>
          <Form.Item
            label="核心指令"
            name="instructions"
            rules={[{ required: true, message: "请输入核心指令" }]}
          >
            <Input.TextArea maxLength={8_000} rows={8} />
          </Form.Item>
          <div className="skillFormGrid">
            <Form.Item label="使用条件" name="usageConditions">
              <Input.TextArea maxLength={2_000} rows={3} />
            </Form.Item>
            <Form.Item label="输入要求" name="inputGuidance">
              <Input.TextArea maxLength={2_000} rows={3} />
            </Form.Item>
            <Form.Item label="输出要求" name="outputGuidance">
              <Input.TextArea maxLength={2_000} rows={3} />
            </Form.Item>
            <Form.Item label="限制" name="limitations">
              <Input.TextArea maxLength={2_000} rows={3} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </section>
  );
}
