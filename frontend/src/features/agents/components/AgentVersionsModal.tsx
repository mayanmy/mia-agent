import { HistoryOutlined, ReloadOutlined, RocketOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Input, Modal, Space, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import {
  activateAgentVersion,
  createAgentVersion,
  listAgentReleases,
  listAgentVersions,
  type AgentListItem,
  type AgentReleaseListItem,
  type AgentVersionListItem
} from "../api";

type Props = {
  agent: AgentListItem | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

/** Agent 不可变版本和发布历史入口；所有并发冲突由后端 revision 再次校验。 */
export function AgentVersionsModal({ agent, open, onClose, onChanged }: Props) {
  const { message, modal } = AntdApp.useApp();
  const [versions, setVersions] = useState<AgentVersionListItem[]>([]);
  const [releases, setReleases] = useState<AgentReleaseListItem[]>([]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && agent) void refresh(agent.id);
  }, [open, agent?.id]);

  async function refresh(agentId: string) {
    setLoading(true);
    try {
      const [versionPage, releaseList] = await Promise.all([
        listAgentVersions(agentId),
        listAgentReleases(agentId)
      ]);
      setVersions(versionPage.list);
      setReleases(releaseList);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载版本失败");
    } finally {
      setLoading(false);
    }
  }

  async function freezeDraft() {
    if (!agent) return;
    setLoading(true);
    try {
      const version = await createAgentVersion(agent.id, {
        expectedDraftRevision: agent.draftRevision,
        changeSummary: summary.trim()
      });
      setSummary("");
      message.success(`已创建 v${version.version}`);
      await refresh(agent.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建版本失败");
    } finally {
      setLoading(false);
    }
  }

  function isRollbackVersion(version: AgentVersionListItem) {
    const publishedVersion = versions.find((item) => item.isPublished);
    return Boolean(publishedVersion && version.version < publishedVersion.version);
  }

  function confirmActivate(version: AgentVersionListItem) {
    if (!agent || version.isPublished) return;
    const rollback = isRollbackVersion(version);
    modal.confirm({
      title: rollback ? `回滚到 v${version.version}` : `发布 v${version.version}`,
      content: rollback
        ? "回滚只切换线上版本，不会覆盖当前草稿。新请求会立即使用该历史版本。"
        : "发布后正式 Chat、Widget 和 Service API 将使用该不可变版本。",
      okText: rollback ? "确认回滚" : "确认发布",
      onOk: async () => {
        const result = await activateAgentVersion(agent.id, {
          versionId: version.id,
          action: rollback ? "ROLLBACK" : "PUBLISH",
          expectedReleaseRevision: agent.releaseRevision,
          reason: rollback ? `回滚到 v${version.version}` : `发布 v${version.version}`
        });
        message.success(rollback ? "Agent 已回滚" : "Agent 已发布");
        await onChanged();
        await refresh(agent.id);
        return result;
      }
    });
  }

  return (
    <Modal
      footer={null}
      open={open}
      title={agent ? `${agent.name} · 版本与发布` : "版本与发布"}
      width={900}
      onCancel={onClose}
    >
      <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
        <Input
          placeholder="版本说明，例如：调整拒答规则与订单工具"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        <Button
          icon={<RocketOutlined />}
          loading={loading}
          type="primary"
          onClick={() => void freezeDraft()}
        >
          冻结当前草稿
        </Button>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => agent && void refresh(agent.id)}
        />
      </Space.Compact>

      <Table<AgentVersionListItem>
        loading={loading}
        pagination={false}
        rowKey="id"
        dataSource={versions}
        columns={[
          {
            title: "版本",
            render: (_, version) => (
              <Space>
                <strong>v{version.version}</strong>
                {version.isPublished ? <Tag color="blue">线上</Tag> : null}
              </Space>
            )
          },
          { title: "说明", dataIndex: "changeSummary", render: (value) => value || "—" },
          {
            title: "配置摘要",
            dataIndex: "configHash",
            render: (value: string) => <Typography.Text code>{value.slice(0, 12)}</Typography.Text>
          },
          { title: "创建者", render: (_, version) => version.createdBy.displayName },
          {
            title: "创建时间",
            render: (_, version) => new Date(version.createdAt).toLocaleString()
          },
          {
            title: "操作",
            render: (_, version) => (
              <Button
                disabled={version.isPublished}
                icon={<HistoryOutlined />}
                size="small"
                onClick={() => confirmActivate(version)}
              >
                {isRollbackVersion(version) ? "回滚" : "发布"}
              </Button>
            )
          }
        ]}
      />

      <Typography.Title level={5}>最近发布记录</Typography.Title>
      <Space wrap>
        {releases.length === 0 ? (
          <Typography.Text type="secondary">暂无发布记录</Typography.Text>
        ) : (
          releases.slice(0, 10).map((release) => (
            <Tag key={release.id} color={release.action === "ROLLBACK" ? "orange" : "default"}>
              #{release.sequence} {release.action} · {new Date(release.createdAt).toLocaleString()}
            </Tag>
          ))
        )}
      </Space>
    </Modal>
  );
}
