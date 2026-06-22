import { Button, Drawer, Popconfirm, Space, Table, Tag, Upload } from "antd";
import type { TableProps } from "antd";

import type { KnowledgeBaseTableItem, KnowledgeDocumentTableItem } from "../types";

type UploadRequestOptions = {
  file: string | Blob;
  onError?: (error: Error) => void;
  onSuccess?: (response: unknown) => void;
};

export function KnowledgeDocumentDrawer({
  open,
  knowledgeBase,
  documents,
  loading,
  uploading,
  pagination,
  onClose,
  onDelete,
  onPageChange,
  onReindex,
  onRefresh,
  onUpload
}: {
  open: boolean;
  knowledgeBase: KnowledgeBaseTableItem | null;
  documents: KnowledgeDocumentTableItem[];
  loading: boolean;
  uploading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  onClose: () => void;
  onDelete: (documentId: string) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onReindex: (documentId: string) => void;
  onRefresh: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const columns: TableProps<KnowledgeDocumentTableItem>["columns"] = [
    {
      title: "文件名",
      dataIndex: "originalFilename",
      key: "originalFilename",
      fixed: "left",
      width: 240
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => renderStatus(status)
    },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      width: 110,
      render: (fileSize: string) => formatFileSize(Number(fileSize))
    },
    {
      title: "Chunk",
      dataIndex: "chunkCount",
      key: "chunkCount",
      width: 90
    },
    {
      title: "错误",
      dataIndex: "errorMessage",
      key: "errorMessage",
      width: 220,
      ellipsis: true,
      render: (message: string | null) => message || "-"
    },
    {
      title: "上传时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => formatDate(createdAt)
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, record) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => onReindex(record.id)}>
            重建
          </Button>
          <Popconfirm
            cancelText="取消"
            okButtonProps={{ danger: true }}
            okText="删除"
            title="删除这个文档？"
            onConfirm={() => onDelete(record.id)}
          >
            <Button danger size="small" type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <Drawer
      destroyOnHidden
      extra={
        <Space>
          <Button disabled={loading} onClick={onRefresh}>
            刷新
          </Button>
          <Upload
            accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json"
            customRequest={(options) => void handleUpload(options, onUpload)}
            disabled={!knowledgeBase || uploading}
            maxCount={1}
            showUploadList={false}
          >
            <Button loading={uploading} type="primary">
              上传文档
            </Button>
          </Upload>
        </Space>
      }
      open={open}
      title={knowledgeBase ? `${knowledgeBase.name} · 文档` : "知识库文档"}
      width={960}
      onClose={onClose}
    >
      <Table<KnowledgeDocumentTableItem>
        columns={columns}
        dataSource={documents}
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true
        }}
        rowKey="id"
        scroll={{ x: 1090 }}
        onChange={(nextPagination) => {
          onPageChange(nextPagination.current || 1, nextPagination.pageSize || 20);
        }}
      />
    </Drawer>
  );
}

async function handleUpload(
  options: UploadRequestOptions,
  onUpload: (file: File) => Promise<void>
) {
  try {
    await onUpload(options.file as File);
    options.onSuccess?.("ok");
  } catch (error) {
    options.onError?.(error as Error);
  }
}

function renderStatus(status: string) {
  const statusMap: Record<string, { color: string; label: string }> = {
    uploaded: { color: "blue", label: "已上传" },
    pending: { color: "gold", label: "待处理" },
    processing: { color: "processing", label: "处理中" },
    indexed: { color: "green", label: "已索引" },
    failed: { color: "red", label: "失败" },
    deleted: { color: "default", label: "已删除" }
  };
  const item = statusMap[status] ?? { color: "default", label: status };

  return <Tag color={item.color}>{item.label}</Tag>;
}

function formatFileSize(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
