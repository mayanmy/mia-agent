import { Button, Dropdown, Space, Table, Tag } from "antd";
import type { MenuProps, TableProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

import type { AgentTableItem } from "../types";

/** Agent 表格的分页状态。 */
type AgentTablePagination = {
  /** 当前页码。 */
  page: number;
  /** 每页记录数。 */
  pageSize: number;
  /** 服务端记录总数。 */
  total: number;
};

/** Agent 表格的展示数据与操作回调。 */
type AgentTableProps = {
  /** 当前页 Agent 数据。 */
  agents: AgentTableItem[];
  /** 是否正在加载列表。 */
  loading: boolean;
  /** 服务端分页状态。 */
  pagination: AgentTablePagination;
  /** 页码或每页数量变化回调。 */
  onPageChange: (page: number, pageSize: number) => void;
  /** 打开 Agent 测试对话。 */
  onTest: (agentId: string) => void;
  /** 发布 Agent。 */
  onPublish: (agentId: string) => void;
  /** 复制 Agent 分享链接。 */
  onCopyLink: (agent: AgentTableItem) => void;
  /** 打开嵌入代码弹窗。 */
  onOpenEmbed: (agent: AgentTableItem) => void;
  /** 打开 API Key 管理弹窗。 */
  onOpenApiKeys: (agent: AgentTableItem) => void;
  /** 打开公开访问安全设置。 */
  onOpenPublicAccess: (agent: AgentTableItem) => void;
  /** 取消发布 Agent。 */
  onUnpublish: (agentId: string) => void;
  /** 打开 Agent 编辑弹窗。 */
  onEdit: (agentId: string) => void;
  /** 删除 Agent。 */
  onDelete: (agentId: string) => void;
};

/** 展示 Agent 状态、绑定摘要及管理操作。 */
export function AgentTable({
  agents,
  loading,
  pagination,
  onPageChange,
  onTest,
  onPublish,
  onCopyLink,
  onOpenEmbed,
  onOpenApiKeys,
  onOpenPublicAccess,
  onUnpublish,
  onEdit,
  onDelete
}: AgentTableProps) {
  const columns: TableProps<AgentTableItem>["columns"] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      fixed: "left",
      width: 180
    },
    {
      title: "关联模型名",
      dataIndex: "modelName",
      key: "modelName",
      width: 180,
      render: (_, record) => `${record.providerName} / ${record.modelName}`
    },
    {
      title: "工具数量",
      dataIndex: "toolCount",
      key: "toolCount",
      width: 100
    },
    {
      title: "知识库数量",
      dataIndex: "knowledgeBaseCount",
      key: "knowledgeBaseCount",
      width: 120
    },
    {
      title: "temperature",
      dataIndex: "temperature",
      key: "temperature",
      width: 120
    },
    {
      title: "启用状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 110,
      render: (enabled: boolean) => (
        <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "发布状态",
      dataIndex: "published",
      key: "published",
      width: 110,
      render: (published: boolean) => (
        <Tag color={published ? "blue" : "default"}>{published ? "已发布" : "未发布"}</Tag>
      )
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatDate(createdAt)
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 160,
      render: (_, record) => {
        const menuItems: MenuProps["items"] = [
          record.published
            ? {
                key: "copy",
                label: "复制链接"
              }
            : {
                key: "publish",
                label: "发布"
              },
          ...(record.published
            ? [
                {
                  key: "embed",
                  label: "嵌入代码"
                },
                {
                  key: "api-keys",
                  label: "服务端 API Key"
                },
                {
                  key: "public-access",
                  label: "公开访问设置"
                },
                {
                  key: "unpublish",
                  label: "取消发布"
                }
              ]
            : []),
          {
            type: "divider"
          },
          {
            key: "edit",
            label: "编辑"
          },
          {
            key: "delete",
            label: "删除",
            danger: true
          }
        ];

        const handleMenuClick: MenuProps["onClick"] = ({ key }) => {
          if (key === "publish") {
            onPublish(record.id);
            return;
          }

          if (key === "copy") {
            onCopyLink(record);
            return;
          }

          if (key === "embed") {
            onOpenEmbed(record);
            return;
          }

          if (key === "api-keys") {
            onOpenApiKeys(record);
            return;
          }

          if (key === "public-access") {
            onOpenPublicAccess(record);
            return;
          }

          if (key === "unpublish") {
            onUnpublish(record.id);
            return;
          }

          if (key === "edit") {
            onEdit(record.id);
            return;
          }

          if (key === "delete") {
            onDelete(record.id);
          }
        };

        return (
          <Space className="agentActionCell" size={4}>
            <Button type="link" size="small" onClick={() => onTest(record.id)}>
              测试对话
            </Button>
            <Dropdown menu={{ items: menuItems, onClick: handleMenuClick }} trigger={["click"]}>
              <Button aria-label="更多操作" icon={<MoreOutlined />} size="small" type="text" />
            </Dropdown>
          </Space>
        );
      }
    }
  ];

  return (
    <Table<AgentTableItem>
      columns={columns}
      dataSource={agents}
      loading={loading}
      pagination={{
        current: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true
      }}
      rowKey="id"
      scroll={{ x: 1320 }}
      onChange={(nextPagination) => {
        onPageChange(nextPagination.current || 1, nextPagination.pageSize || 20);
      }}
    />
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
