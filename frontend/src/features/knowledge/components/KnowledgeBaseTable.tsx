import { Button, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";

import type { KnowledgeBaseTableItem } from "../types";

export function KnowledgeBaseTable({
  knowledgeBases,
  loading,
  pagination,
  onPageChange,
  onEdit,
  onDelete
}: {
  knowledgeBases: KnowledgeBaseTableItem[];
  loading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  onPageChange: (page: number, pageSize: number) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const columns: TableProps<KnowledgeBaseTableItem>["columns"] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      fixed: "left",
      width: 180
    },
    {
      title: "Embedding 模型",
      key: "embeddingModel",
      width: 220,
      render: (_, record) => `${record.embeddingProviderName} / ${record.embeddingModelName}`
    },
    {
      title: "文档数",
      dataIndex: "documentCount",
      key: "documentCount",
      width: 100
    },
    {
      title: "Chunk 数",
      dataIndex: "chunkCount",
      key: "chunkCount",
      width: 100
    },
    {
      title: "失败文档",
      dataIndex: "failedDocumentCount",
      key: "failedDocumentCount",
      width: 110,
      render: (count: number) => (
        <Tag color={count > 0 ? "red" : "default"}>{count > 0 ? `${count} 个` : "无"}</Tag>
      )
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
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (updatedAt: string) => formatDate(updatedAt)
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 140,
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => onEdit(record.id)}>
            编辑
          </Button>
          <Button danger size="small" type="link" onClick={() => onDelete(record.id)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <Table<KnowledgeBaseTableItem>
      columns={columns}
      dataSource={knowledgeBases}
      loading={loading}
      pagination={{
        current: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true
      }}
      rowKey="id"
      scroll={{ x: 1140 }}
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
